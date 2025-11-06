function applyBrand(brand = {}) {
  // accept either 'accent' or legacy 'primary'
  const accent = brand.accent || brand.primary || '#22c55e';
  const text   = brand.text   || '#e5e7eb';
  const bg1    = brand.bg1    || '#0b1316';
  const bg2    = brand.bg2    || '#0f1a1f';

  // Set CSS variables
  const r = document.documentElement.style;
  r.setProperty('--color-accent', accent);
  r.setProperty('--color-text',   text);
  r.setProperty('--bg-1',         bg1);
  r.setProperty('--bg-2',         bg2);

  // Header / hero imagery (ignore if missing)
  const logoEl = document.querySelector('[data-brand-logo]');
  if (logoEl && brand.logo) {
    logoEl.src = brand.logo;
    logoEl.alt = 'Brand logo';
  }
  const heroEl = document.querySelector('[data-hero]');
  if (heroEl && brand.hero) {
    heroEl.style.backgroundImage = `url("${brand.hero}")`;
    heroEl.style.backgroundSize = 'cover';
    heroEl.style.backgroundPosition = 'center';
  }
}