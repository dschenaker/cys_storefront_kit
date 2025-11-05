async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return r.json();
}

function applyTheme(theme = {}) {
  const root = document.documentElement;
  const map = {
    "--accent": theme.accent,
    "--text": theme.text,
    "--muted": theme.muted,
    "--card": theme.card,
    "--card-edge": theme.cardEdge,
    "--btn": theme.btn,
    "--btn-text": theme.btnText
  };
  Object.entries(map).forEach(([k, v]) => { if (v) root.style.setProperty(k, v); });
}

function setHero({ brand = {}, heading, subheading, name }) {
  const logoEl = document.getElementById("brand-logo");
  const titleEl = document.getElementById("site-title");
  const subEl = document.getElementById("site-subtitle");
  const footerBrand = document.getElementById("brand-name");
  const yearEl = document.getElementById("year");
  const heroBlock = document.querySelector(".hero");

  if (logoEl && brand.logo) logoEl.src = brand.logo;
  if (titleEl) titleEl.textContent = heading || name || "Storefront";
  if (subEl) subEl.textContent = subheading || "";
  if (footerBrand) footerBrand.textContent = name || "Storefront";
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // hero background image
  if (brand.hero && heroBlock) {
    heroBlock.style.setProperty("--hero-img", `url("${brand.hero}")`);
    // fallback for older CSS: set directly on ::after through style attribute
    const stylesheetHero = document.querySelector("style[data-hero]");
    if (!stylesheetHero) {
      const s = document.createElement("style");
      s.dataset.hero = "1";
      s.textContent = `.hero::after{background-image:url("${brand.hero}")}`;
      document.head.appendChild(s);
    } else {
      stylesheetHero.textContent = `.hero::after{background-image:url("${brand.hero}")}`;
    }
  }
}

function allowed(product, cfg) {
  const sku = product.sku || "";
  if (Array.isArray(cfg.sku_allowlist) && cfg.sku_allowlist.length) {
    if (cfg.sku_allowlist.includes(sku)) return true;
  }
  if (Array.isArray(cfg.sku_prefixes) && cfg.sku_prefixes.length) {
    if (cfg.sku_prefixes.some(p => sku.startsWith(p))) return true;
  }
  // if lists exist and none matched -> hide
  if ((cfg.sku_allowlist && cfg.sku_allowlist.length) || (cfg.sku_prefixes && cfg.sku_prefixes.length)) {
    return false;
  }
  return true; // default show
}

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
    img.alt = p.name || "Product";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "100%";
    if (Array.isArray(p.images) && p.images.length) img.src = p.images[0];
    media.appendChild(img);

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = p.name || p.sku;

    const price = document.createElement("div");
    price.className = "card-price";
    price.textContent = p.price != null ? `$${Number(p.price).toFixed(2)}` : "";

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

async function start() {
  // 1) client config (branding + filter)
  const client = await loadJSON("data/client.json");
  applyTheme(client.theme || {});
  setHero(client);

  // 2) products (already built from Notion)
  const products = await loadJSON("data/products.json");

  // 3) filter to client inventory
  const filtered = products.filter(p => allowed(p, client));
  render(filtered);
}

start().catch(err => {
  console.error(err);
  const grid = document.getElementById("grid");
  if (grid) grid.innerHTML = `<div style="color:#f87171">Error: ${err.message}</div>`;
});