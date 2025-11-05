// app.js — minimal, stable storefront renderer
(async function () {
  const CONFIG_URL = "data/client.json";
  const PRODUCTS_URL = "data/products.json";

  // ----- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmtMoney = (n, curr = "USD") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: curr }).format(n);

  async function loadJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return res.json();
  }

  function filterProducts(all, cfg) {
    const allow = new Set((cfg.sku_allowlist || []).map(s => s.trim()).filter(Boolean));
    const prefixes = (cfg.sku_prefixes || []).map(p => p.trim()).filter(Boolean);

    if (allow.size === 0 && prefixes.length === 0) return all;

    return all.filter(p => {
      const sku = (p.sku || "").trim();
      const inAllow = allow.size > 0 && allow.has(sku);
      const hasPrefix = prefixes.length > 0 && prefixes.some(pref => sku.startsWith(pref));
      return inAllow || hasPrefix;
    });
  }

  function applyBranding(cfg) {
    // Name
    const nameNode = $("#site-title");
    if (nameNode) nameNode.textContent = cfg.name || "Storefront";

    // Logo
    const logoImg = $("#brand-logo");
    if (logoImg && cfg.brand?.logo) {
      logoImg.src = cfg.brand.logo;
      logoImg.alt = `${cfg.name || "Brand"} logo`;
    }

    // Accent color
    if (cfg.brand?.accent) {
      document.documentElement.style.setProperty("--accent", cfg.brand.accent);
    }

    // Hero (as subtle page bg)
    if (cfg.brand?.hero) {
      document.body.style.setProperty(
        "--hero-url",
        `url("${cfg.brand.hero}")`
      );
      document.body.classList.add("has-hero");
    }
  }

  function guessImage(cfg, product) {
    // 1) If products.json has an explicit image/url field, use it.
    if (product.image) return product.image;
    if (product.images && product.images.length) return product.images[0];

    // 2) Fallback to a predictable assets path by SKU.
    //    Put files at assets/products/<slug>/<SKU>.jpg or .png
    const base = `assets/products/${cfg.slug || "default"}/${product.sku || ""}`;
    return `${base}.jpg`;
  }

  function renderProducts(list, cfg, currency = "USD") {
    const grid = $("#grid");
    grid.innerHTML = ""; // clear

    for (const p of list) {
      const card = document.createElement("article");
      card.className = "card";

      // media
      const media = document.createElement("div");
      media.className = "card-media";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = p.name || "";
      img.src = guessImage(cfg, p);
      img.onerror = () => { img.src = "assets/placeholder.svg"; };
      media.appendChild(img);

      // body
      const body = document.createElement("div");
      body.className = "card-body";

      const title = document.createElement("h3");
      title.className = "card-title";
      title.textContent = p.name || p.sku || "Product";

      const price = document.createElement("div");
      price.className = "card-price";
      // price may be number or string in products.json; coerce if needed
      const n = typeof p.price === "number" ? p.price : Number(p.price);
      price.textContent = isFinite(n) ? fmtMoney(n, currency) : "";

      const buy = document.createElement("a");
      buy.className = "btn-buy";
      buy.textContent = "Buy";
      buy.href = p.link || "#";
      buy.target = "_blank";
      buy.rel = "noopener noreferrer";

      body.appendChild(title);
      body.appendChild(price);
      body.appendChild(buy);

      card.appendChild(media);
      card.appendChild(body);
      grid.appendChild(card);
    }
  }

  // ----- bootstrap
  try {
    const [cfg, allProducts] = await Promise.all([
      loadJSON(CONFIG_URL),
      loadJSON(PRODUCTS_URL),
    ]);

    applyBranding(cfg);
    const filtered = filterProducts(allProducts, cfg);

    // products.json rows usually include a currency field (we also allow fallback)
    const currency = filtered.find(p => p.currency)?.currency || "USD";
    renderProducts(filtered, cfg, currency);
  } catch (err) {
    console.error(err);
    const grid = $("#grid");
    if (grid) grid.innerHTML = `<div class="error">Failed to load storefront: ${err.message}</div>`;
  }
})();