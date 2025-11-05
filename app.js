// app.js
async function loadAll() {
  const client = await (await fetch('data/client.json')).json();
  const res = await fetch('data/products.json', { cache: 'no-store' });
  let products = await res.json();

  // Filter by sku_allowlist and/or sku_prefixes (OR logic)
  const allow = new Set((client.sku_allowlist || []).map(s => s.trim()));
  const prefixes = client.sku_prefixes || [];
  if (allow.size || prefixes.length) {
    products = products.filter(p => allow.has(p.sku) || prefixes.some(pre => p.sku.startsWith(pre)));
  }

  // Apply branding
  const titleEl = document.querySelector('[data-brand-title]');
  const logoEl  = document.querySelector('[data-brand-logo]');
  if (titleEl) titleEl.textContent = client.name || 'Storefront';
  if (logoEl) {
    if (client.brand?.logo) { logoEl.src = client.brand.logo; logoEl.hidden = false; }
    else { logoEl.hidden = true; }
  }
  if (client.brand?.accent) {
    document.documentElement.style.setProperty('--accent', client.brand.accent);
  }

  renderGrid(products);
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'src') n.src = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

function renderGrid(products) {
  const grid = document.querySelector('#grid');
  grid.innerHTML = '';

  const fallback = 'assets/media/placeholder.svg'; // change if needed

  for (const p of products) {
    const img = el('img', { class: 'card-img', src: p.image || fallback, alt: p.name });
    const name = el('div', { class: 'card-title', text: p.name });
    const price = el('div', { class: 'card-price', text: `$${Number(p.price).toFixed(2)}` });

    const variants = (Array.isArray(p.variants) && p.variants.length)
      ? el('div', { class: 'card-variants' },
          ...p.variants.slice(0, 8).map(v => el('span', { class: 'chip', text: v })))
      : el('div');

    const buy = el('a', {
      class: 'card-buy',
      href: p.link || '#',
      target: '_blank',
      rel: 'noopener',
      text: 'Buy'
    });

    const card = el('div', { class: 'card' }, img, name, price, variants, buy);
    grid.append(card);
  }
}

loadAll().catch(console.error);