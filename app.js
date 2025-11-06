// app.js — storefront renderer + inline admin
const qs = sel => document.querySelector(sel);
const el = {
  title: qs('#site-title'),
  name: qs('#brand-name'),
  tag: qs('#brand-tag'),
  logo: qs('#brand-logo'),
  year: qs('#year'),
  footerName: qs('#footer-name'),
  products: qs('#products'),
  watermark: qs('#watermark'),
  dlgAdmin: qs('#admin-dialog'),
  dlgPin: qs('#pin-dialog'),
  adminLink: qs('#admin-link'),

  // admin inputs
  inpLogo: qs('#inp-logo'),
  inpHero: qs('#inp-hero'),
  inpPrimary: qs('#inp-primary'),
  inpText: qs('#inp-text'),
  inpBg1: qs('#inp-bg1'),
  inpBg2: qs('#inp-bg2'),
  wmOpacity: qs('#wm-opacity'),
  wmSat: qs('#wm-sat'),
  wmCtr: qs('#wm-ctr'),

  btnSave: qs('#admin-save'),
  btnReset: qs('#admin-reset'),
  btnClose: qs('#admin-close'),

  dlgPinOk: qs('#pin-ok'),
  pinInput: qs('#pin-input'),
};

el.year.textContent = String(new Date().getFullYear());

async function loadJSON(p) {
  const res = await fetch(p, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${p}: ${res.status}`);
  return res.json();
}

function readClientDefaults(client) {
  const brand = client.brand || {};
  const pin = client.admin_pin || '0000';
  return {
    name: client.name || 'Storefront',
    slug: client.slug || 'store',
    // branding
    logo: brand.logo || 'assets/media/cys-logo.jpg',
    hero: brand.hero || 'assets/media/cys-hero.jpg',
    accent: brand.accent || '#0f172a',
    text: brand.text || '#e6eef7',
    bg1: brand.bg1 || '#0b0c12',
    bg2: brand.bg2 || '#161820',
    wm: { opacity: 0.25, sat: 1.1, ctr: 1.2 },
    pin,
    // filters
    sku_allowlist: client.sku_allowlist || [],
    sku_prefixes: client.sku_prefixes || [],
  };
}

function storageKey(slug) {
  return `storefront:${slug}:settings`;
}

function loadOverrides(slug) {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveOverrides(slug, ovr) {
  localStorage.setItem(storageKey(slug), JSON.stringify(ovr));
}

function applyTheme(cfg) {
  document.documentElement.style.setProperty('--color-primary', cfg.accent);
  document.documentElement.style.setProperty('--color-text', cfg.text);
  document.documentElement.style.setProperty('--color-bg1', cfg.bg1);
  document.documentElement.style.setProperty('--color-bg2', cfg.bg2);

  el.watermark.style.backgroundImage = cfg.hero ? `url("${cfg.hero}")` : 'none';
  el.watermark.style.opacity = String(cfg.wm.opacity);
  el.watermark.style.filter = `saturate(${cfg.wm.sat}) contrast(${cfg.wm.ctr})`;

  el.logo.src = cfg.logo || '';
  el.name.textContent = cfg.name;
  el.title.textContent = cfg.name;
  el.footerName.textContent = cfg.name;
}

function setAdminInputs(cfg) {
  el.inpLogo.value = cfg.logo || '';
  el.inpHero.value = cfg.hero || '';
  el.inpPrimary.value = toHex(cfg.accent);
  el.inpText.value = toHex(cfg.text);
  el.inpBg1.value = toHex(cfg.bg1);
  el.inpBg2.value = toHex(cfg.bg2);
  el.wmOpacity.value = String(cfg.wm.opacity);
  el.wmSat.value = String(cfg.wm.sat);
  el.wmCtr.value = String(cfg.wm.ctr);
}

function toHex(v) {
  // accept #rgb(a), #rrggbb, or named; fallback to computed style
  const s = document.createElement('span');
  s.style.color = v;
  document.body.appendChild(s);
  const rgb = getComputedStyle(s).color.match(/\d+/g) || [0,0,0];
  document.body.removeChild(s);
  const [r,g,b] = rgb.map(n => Number(n) & 255);
  return '#' + [r,g,b].map(n => n.toString(16).padStart(2,'0')).join('');
}

function filteredProducts(all, allow, prefixes) {
  let result = all;
  if (allow?.length) {
    const set = new Set(allow);
    result = result.filter(p => set.has(p.sku));
  } else if (prefixes?.length) {
    result = result.filter(p => prefixes.some(px => p.sku?.startsWith(px)));
  }
  return result;
}

function productCard(p) {
  const card = document.createElement('article');
  card.className = 'card';

  const media = document.createElement('div');
  media.className = 'card-media';
  // no reliable image in products.json -> leave blank placeholder
  card.appendChild(media);

  const content = document.createElement('div');
  content.className = 'card-body';
  const h = document.createElement('h3');
  h.textContent = p.name;
  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = `$${Number(p.price).toFixed(2)}`;
  content.appendChild(h);
  content.appendChild(price);
  card.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const buy = document.createElement('a');
  buy.className = 'btn primary block';
  buy.textContent = 'Buy';
  buy.href = p.link || '#';
  buy.target = '_blank';
  buy.rel = 'noopener';
  actions.appendChild(buy);
  card.appendChild(actions);

  return card;
}

async function main() {
  // Load client + site data
  const client = await loadJSON('data/client.json');
  const defaults = readClientDefaults(client);
  const saved = loadOverrides(defaults.slug) || {};
  const cfg = { ...defaults, ...saved, wm: { ...defaults.wm, ...(saved.wm || {}) } };

  applyTheme(cfg);
  setAdminInputs(cfg);

  // Bind admin UI
  el.adminLink.addEventListener('click', (e) => {
    e.preventDefault();
    openAdmin(cfg, defaults);
  });
  if (new URL(location.href).searchParams.get('admin') === '1') {
    openAdmin(cfg, defaults, true);
  }

  // Load products
  const all = await loadJSON('data/products.json');
  const list = filteredProducts(all, client.sku_allowlist, client.sku_prefixes);

  // Render
  el.products.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No products available.';
    el.products.appendChild(empty);
  } else {
    for (const p of list) {
      el.products.appendChild(productCard(p));
    }
  }
}

function openAdmin(cfg, defaults, skipPin = false) {
  const unlock = () => {
    setAdminInputs(cfg);
    el.dlgAdmin.showModal();
  };

  if (skipPin) {
    unlock();
    return;
  }

  // PIN flow
  el.pinInput.value = '';
  el.dlgPin.showModal();
  el.dlgPinOk.onclick = (ev) => {
    ev.preventDefault();
    const pin = (el.pinInput.value || '').trim();
    el.dlgPin.close();
    if (pin === (defaults.pin || '0000')) {
      unlock();
    } else {
      alert('Invalid PIN.');
    }
  };
}

function readAdminInputs(cfg) {
  return {
    ...cfg,
    logo: el.inpLogo.value || '',
    hero: el.inpHero.value || '',
    accent: el.inpPrimary.value || cfg.accent,
    text: el.inpText.value || cfg.text,
    bg1: el.inpBg1.value || cfg.bg1,
    bg2: el.inpBg2.value || cfg.bg2,
    wm: {
      opacity: Number(el.wmOpacity.value),
      sat: Number(el.wmSat.value),
      ctr: Number(el.wmCtr.value),
    }
  };
}

// Live preview
['input', 'change'].forEach(evt => {
  el.dlgAdmin?.addEventListener(evt, (e) => {
    if (!e.target) return;
    // build temp cfg and apply
    // get current defaults via client.json is expensive; reuse last applied by reading styles/inputs
    const current = {
      name: el.name.textContent,
      logo: el.inpLogo.value || el.logo.src,
      hero: el.inpHero.value || '',
      accent: el.inpPrimary.value || getComputedStyle(document.documentElement).getPropertyValue('--color-primary'),
      text: el.inpText.value || getComputedStyle(document.documentElement).getPropertyValue('--color-text'),
      bg1: el.inpBg1.value || getComputedStyle(document.documentElement).getPropertyValue('--color-bg1'),
      bg2: el.inpBg2.value || getComputedStyle(document.documentElement).getPropertyValue('--color-bg2'),
      wm: {
        opacity: Number(el.wmOpacity.value),
        sat: Number(el.wmSat.value),
        ctr: Number(el.wmCtr.value),
      }
    };
    applyTheme(current);
  });
});

// Save / Reset
el.btnSave?.addEventListener('click', async (ev) => {
  ev.preventDefault();
  const client = await loadJSON('data/client.json');
  const defaults = readClientDefaults(client);
  const cfg = readAdminInputs(defaults);
  saveOverrides(defaults.slug, cfg);
  applyTheme(cfg);
  el.dlgAdmin.close();
});

el.btnReset?.addEventListener('click', async () => {
  const client = await loadJSON('data/client.json');
  const defaults = readClientDefaults(client);
  localStorage.removeItem(storageKey(defaults.slug));
  applyTheme(defaults);
  setAdminInputs(defaults);
});

main().catch(err => {
  console.error(err);
  el.products.innerHTML = `<p class="error">Failed to load storefront. ${err.message}</p>`;
});