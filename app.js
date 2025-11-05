// Minimal, defensive storefront loader.
// Loads client config + products; renders cards or a visible error.

const els = {
  logo:    document.getElementById('brandLogo'),
  title:   document.getElementById('siteTitle'),
  hero:    document.getElementById('hero'),
  flash:   document.getElementById('flash'),
  grid:    document.getElementById('grid'),
  year:    document.getElementById('year'),
  brandNm: document.getElementById('brandName'),
};
els.year.textContent = new Date().getFullYear();

// ---- utilities
const showError = (msg) => {
  els.flash.hidden = false;
  els.flash.textContent = msg;
  console.error('[storefront]', msg);
};
const $ = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'href') el.setAttribute('href', v);
    else if (k === 'target') el.setAttribute('target', v);
    else el[k] = v;
  }
  for (const kid of kids) {
    if (kid == null) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
};

// ---- load JSON helpers (with friendlier errors)
async function loadJson(path, name){
  try{
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${name} fetch failed (${res.status})`);
    return await res.json();
  }catch(e){
    showError(`${name} error: ${e.message}`);
    throw e;
  }
}

// ---- main
(async function start(){
  // 1) Load client + products
  const client = await loadJson('./data/client.json', 'client.json');
  const products = await loadJson('./data/products.json', 'products.json');

  // 2) Apply brand
  const brandName = client?.name || 'Storefront';
  els.title.textContent = brandName;
  els.brandNm.textContent = brandName;

  // Logo (optional)
  if (client?.brand?.logo) {
    els.logo.src = client.brand.logo;
    els.logo.alt = `${brandName} logo`;
  } else {
    els.logo.style.display = 'none';
  }

  // Hero (optional)
  if (client?.brand?.hero) {
    els.hero.style.backgroundImage = `url("${client.brand.hero}")`;
  }

  // Accent (optional)
  if (client?.brand?.accent) {
    document.documentElement.style.setProperty('--accent', client.brand.accent);
  }

  // 3) Filter products per allowlist/prefix rules
  const allow = new Set(client.sku_allowlist || []);
  const prefixes = client.sku_prefixes || [];
  const keep = (sku) => {
    if (!sku || typeof sku !== 'string') return false;
    if (allow.size && allow.has(sku)) return true;
    if (prefixes.length && prefixes.some(p => sku.startsWith(p))) return true;
    return allow.size === 0 && prefixes.length === 0; // if neither provided, keep all
  };

  const filtered = products.filter(p => keep(p.sku));

  if (!filtered.length) {
    showError('No products matched your client filters. Check client.json sku list or prefixes.');
  }

  // 4) Render cards (tolerant of missing image/link)
  els.grid.replaceChildren(
    ...filtered.map(p => {
      const img = $('.card-media', {},
        'image'
      );
      if (p.image) {
        img.style.background = `#0b0f14 url("${p.image}") center/cover no-repeat`;
        img.textContent = '';
      }

      const body = $('.card-body', {},
        $('.card-title', {}, p.name || p.sku || 'Item'),
        $('.card-price', {}, p.price != null ? `$${Number(p.price).toFixed(2)}` : '')
      );

      const foot = $('.card-foot', {},
        (p.link
          ? $('a', { class: 'card-buy', href: p.link, target: '_blank' }, 'Buy')
          : $('div', { class: 'card-buy', style: 'opacity:.5;pointer-events:none' }, 'Link missing'))
      );

      return $('.card', {}, img, body, foot);
    })
  );
})();