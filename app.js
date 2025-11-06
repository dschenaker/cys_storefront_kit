/* App – CYS storefront (brandable, variants, images)
   Requirements:
   - data/products.json rows like:
     { id, name, sku, price, currency, link, active, images:[{url,alt}], variants:[{label, url}] }
   - data/client.json with brand + filters
*/

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel, ctx));

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function setBrandTheme(brand) {
  // CSS variables drive the theme
  const root = document.documentElement;
  if (brand.accent) root.style.setProperty("--accent", brand.accent);
  if (brand.bg1) root.style.setProperty("--bg1", brand.bg1);
  if (brand.bg2) root.style.setProperty("--bg2", brand.bg2);
  if (brand.text) root.style.setProperty("--text", brand.text);

  // logo/hero (optional)
  const logoEl = $("#brand-logo");
  const heroEl = $("#brand-hero");
  if (logoEl && brand.logo)   logoEl.src = brand.logo;
  if (heroEl && brand.hero)   heroEl.style.backgroundImage = `url("${brand.hero}")`;
}

function byClientFilter(products, client) {
  // If sku_allowlist present → strict allow.
  // Else if sku_prefixes present → allow by prefix(es).
  // Else return as-is.
  let out = products.slice();
  if (Array.isArray(client.sku_allowlist) && client.sku_allowlist.length) {
    const set = new Set(client.sku_allowlist.map(s => String(s).trim()));
    out = out.filter(p => set.has(p.sku));
  } else if (Array.isArray(client.sku_prefixes) && client.sku_prefixes.length) {
    out = out.filter(p => client.sku_prefixes.some(pref => p.sku?.startsWith(pref)));
  }
  return out.filter(p => p.active);
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}

function renderProducts(list) {
  const grid = $("#grid");
  grid.innerHTML = "";

  list.forEach(p => {
    const card = document.createElement("article");
    card.className = "card";

    // media area
    const media = document.createElement("div");
    media.className = "card-media";

    // primary image (fallback to pattern)
    const primaryUrl = p.images?.[0]?.url || "";
    if (primaryUrl) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = p.images?.[0]?.alt || p.name || "product image";
      img.src = primaryUrl;
      media.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "ph";
      media.appendChild(ph);
    }

    // variant thumbs, if any
    if (Array.isArray(p.variants) && p.variants.length) {
      const thumbs = document.createElement("div");
      thumbs.className = "thumbs";
      p.variants.slice(0, 6).forEach(v => {
        if (!v.url) return;
        const t = document.createElement("img");
        t.loading = "lazy";
        t.alt = v.label || p.name;
        t.src = v.url;
        t.addEventListener("click", () => openModal(p, v.url));
        thumbs.appendChild(t);
      });
      media.appendChild(thumbs);
      media.addEventListener("click", () => openModal(p, primaryUrl));
    } else {
      // still open modal on primary if present
      if (primaryUrl) media.addEventListener("click", () => openModal(p, primaryUrl));
    }

    // body
    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("h3");
    title.textContent = p.name || p.sku || "Product";
    const price = document.createElement("div");
    price.className = "price";
    price.textContent = money(p.price || 0);

    // CTA
    const cta = document.createElement("button");
    cta.className = "btn";
    cta.textContent = "Buy";
    cta.addEventListener("click", () => {
      if (!p.link) return alert("No Stripe link for this product yet.");
      window.location.href = p.link;
    });

    body.appendChild(title);
    body.appendChild(price);
    body.appendChild(cta);

    card.appendChild(media);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

/* ---------- Modal viewer ---------- */
function openModal(product, startUrl) {
  const modal = $("#modal");
  const modalImg = $("#modal-img");
  const caption = $("#modal-cap");
  const rail = $("#modal-rail");
  const close = $("#modal-close");

  // Build image deck from primary + variants
  const deck = [];
  if (product.images?.length) deck.push(...product.images.map(i => i.url).filter(Boolean));
  if (product.variants?.length) deck.push(...product.variants.map(v => v.url).filter(Boolean));
  const uniq = [...new Set(deck)];
  if (!uniq.length) return;

  // pick start
  let current = uniq.indexOf(startUrl);
  if (current < 0) current = 0;

  function show(i) {
    current = i;
    modalImg.src = uniq[current];
    caption.textContent = product.name || "";
    rail.innerHTML = "";
    uniq.forEach((u, idx) => {
      const t = document.createElement("img");
      t.src = u;
      t.className = idx === current ? "active" : "";
      t.addEventListener("click", () => show(idx));
      rail.appendChild(t);
    });
  }

  close.onclick = () => modal.close();
  modal.addEventListener("click", (e) => {
    const rect = modalImg.getBoundingClientRect();
    if (!e.composedPath().includes(modalImg) && !e.composedPath().includes(rail)) modal.close();
  });

  show(current);
  modal.showModal();
}

/* ---------- Boot ---------- */
(async function start() {
  try {
    const [client, products] = await Promise.all([
      loadJSON("data/client.json"),
      loadJSON("data/products.json"),
    ]);

    // brand header + hero + colors
    setBrandTheme(client.brand || {});

    // title
    $("#site-title").textContent = client.name || "Storefront";

    // filter products for this client
    const filtered = byClientFilter(products, client);

    // render
    renderProducts(filtered);

  } catch (e) {
    console.error(e);
    $("#grid").innerHTML = `<div class="error">Failed to load catalog. Please refresh.</div>`;
  }
})();