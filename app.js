// app.js — client-aware storefront
async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${url} -> ${res.status}`);
  return res.json();
}

function applyBranding(client) {
  const name = client?.name || "Storefront";
  const brand = client?.brand || {};

  // Page title + navbar title
  document.title = `${name}`;
  const brandEl = document.querySelector("[data-brand]");
  if (brandEl) brandEl.textContent = name;

  // Logo
  const logoEl = document.querySelector("[data-logo]");
  if (logoEl && brand.logo) {
    logoEl.src = brand.logo;
    logoEl.alt = `${name} logo`;
    logoEl.style.display = "";
  }

  // Hero / background image
  const heroEl = document.querySelector("[data-hero]");
  if (heroEl && brand.hero) {
    heroEl.style.backgroundImage = `url(${brand.hero})`;
    heroEl.style.backgroundSize = "cover";
    heroEl.style.backgroundPosition = "center";
    heroEl.style.opacity = "0.12";
  }

  // Accent color (for CSS variable)
  if (brand.accent) {
    document.documentElement.style.setProperty("--accent", brand.accent);
  }
}

function filterProducts(all, client) {
  const allow = new Set((client?.sku_allowlist || []).map(s => s.trim()));
  const prefixes = (client?.sku_prefixes || []).map(s => s.trim());

  if (allow.size === 0 && prefixes.length === 0) return all;

  return all.filter(p => {
    const sku = (p.sku || "").trim();
    if (allow.has(sku)) return true;
    return prefixes.some(pre => sku.startsWith(pre));
  });
}

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(Number(n) || 0);
}

function renderProducts(list) {
  const grid = document.querySelector("#products");
  if (!grid) return;
  grid.innerHTML = "";

  if (!list || list.length === 0) {
    grid.innerHTML = `<div class="empty">No products available.</div>`;
    return;
  }

  for (const p of list) {
    const card = document.createElement("div");
    card.className = "card";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = p.name || p.sku || "Product";
    img.src = `assets/media/${p.sku}.jpg`; // optional per-product images
    img.onerror = () => (img.style.display = "none");

    const name = document.createElement("div");
    name.className = "title";
    name.textContent = p.name || p.sku;

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = fmtMoney(p.price, p.currency);

    const buy = document.createElement("a");
    buy.className = "btn";
    buy.href = p.link || "#";
    buy.textContent = "Buy";
    buy.target = "_blank";
    buy.rel = "noopener noreferrer";

    card.append(img, name, price, buy);
    grid.appendChild(card);
  }
}

async function main() {
  const client = await loadJSON("data/client.json").catch(() => ({}));
  applyBranding(client);

  const all = await loadJSON("data/products.json").catch(() => []);
  const visible = filterProducts(all, client);
  renderProducts(visible);
}

main().catch(e => {
  console.error(e);
  const grid = document.querySelector("#products");
  if (grid) grid.innerHTML = `<div class="error">Load error — see console</div>`;
});