async function j(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return r.json();
}

// ---------- THEME + HEADER ----------
function setVars(vars = {}) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    if (v) root.style.setProperty(k, v);
  }
}
function applyTheme(theme = {}) {
  setVars({
    "--accent": theme.accent,
    "--text": theme.text,
    "--muted": theme.muted,
    "--card": theme.card,
    "--card-edge": theme.cardEdge,
    "--btn": theme.btn,
    "--btn-text": theme.btnText
  });
}
function setHero({ brand = {}, heading, subheading, name }) {
  const logoEl = document.getElementById("brand-logo");
  const titleEl = document.getElementById("site-title");
  const subEl   = document.getElementById("site-subtitle");
  const yearEl  = document.getElementById("year");
  const brandEl = document.getElementById("brand-name");

  if (logoEl && brand.logo) logoEl.src = brand.logo;
  if (titleEl) titleEl.textContent = heading || name || "Storefront";
  if (subEl)   subEl.textContent   = subheading || "";
  if (brandEl) brandEl.textContent = name || "Storefront";
  if (yearEl)  yearEl.textContent  = new Date().getFullYear();

  if (brand.hero) {
    let tag = document.querySelector("style[data-hero]");
    if (!tag) {
      tag = document.createElement("style");
      tag.dataset.hero = "1";
      document.head.appendChild(tag);
    }
    tag.textContent = `.hero::after{background-image:url("${brand.hero}")}`;
  }
}

// ---------- FILTER ----------
function allowed(p, cfg) {
  const sku = p.sku || "";
  const hasAllow = Array.isArray(cfg.sku_allowlist) && cfg.sku_allowlist.length;
  const hasPref  = Array.isArray(cfg.sku_prefixes)  && cfg.sku_prefixes.length;

  if (hasAllow && cfg.sku_allowlist.includes(sku)) return true;
  if (hasPref  && cfg.sku_prefixes.some(pre => sku.startsWith(pre))) return true;
  if (hasAllow || hasPref) return false; // lists exist, but no match
  return true; // no lists -> show all
}

// ---------- IMAGE PICKER (robust) ----------
function firstUrl(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const x of v) { const u = firstUrl(x); if (u) return u; }
    return null;
  }
  if (typeof v === "object") {
    // Notion file object shapes
    if (v.file && v.file.url) return v.file.url;
    if (v.external && v.external.url) return v.external.url;
    // generic nested
    for (const k of Object.keys(v)) {
      const u = firstUrl(v[k]);
      if (u) return u;
    }
  }
  return null;
}

function pickImage(product) {
  // common shapes we’ve seen
  return (
    firstUrl(product.images) ||
    firstUrl(product.image)  ||
    firstUrl(product.media)  ||
    firstUrl(product.cover)  ||
    null
  );
}

// ---------- RENDER ----------
function render(products) {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  for (const p of products) {
    const card = document.createElement("div");
    card.className = "card";

    const media = document.createElement("div");
    media.className = "card-media";
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = p.name || p.sku || "Product";

    const url = pickImage(p);
    img.src = url || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    media.appendChild(img);

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = p.name || p.sku;

    const price = document.createElement("div");
    price.className = "card-price";
    const cents = Number(p.price);
    price.textContent = Number.isFinite(cents) ? `$${cents.toFixed(2)}` : "";

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Buy";
    btn.onclick = () => { if (p.link) window.open(p.link, "_blank"); };
    actions.appendChild(btn);

    card.append(media, title, price, actions);
    grid.appendChild(card);
  }
}

// ---------- START ----------
async function start() {
  const client = await j("data/client.json");
  applyTheme(client.theme || {});
  setHero(client);

  const all = await j("data/products.json");
  const filtered = all.filter(p => allowed(p, client));
  render(filtered);
}

start().catch(err => {
  console.error(err);
  const grid = document.getElementById("grid");
  if (grid) grid.innerHTML = `<div style="color:#f87171">Error: ${err.message}</div>`;
});