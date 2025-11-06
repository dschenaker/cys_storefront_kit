cat > scripts/diag_links.mjs <<'EOF'
import 'dotenv/config';
import Stripe from 'stripe';

const MODE = (process.env.STRIPE_MODE || 'live').toLowerCase();
const KEY = MODE === 'test' ? process.env.STRIPE_API_KEY_TEST : process.env.STRIPE_API_KEY_LIVE;
if (!KEY) throw new Error('Missing Stripe key');
const stripe = new Stripe(KEY, { apiVersion: '2024-06-20' });

async function getProductBySku(sku) {
  try {
    const res = await stripe.products.search({
      query: `active:'true' AND metadata['sku']:'${sku.replace(/'/g, "\\'")}'`,
      limit: 1,
    });
    if (res?.data?.[0]) return res.data[0];
  } catch {}
  const list = await stripe.products.list({ active: true, limit: 100 });
  return list.data.find(p => p.metadata?.sku === sku);
}

async function diag(sku, currency, amount) {
  const p = await getProductBySku(sku);
  if (!p) return { sku, ok: false, reason: 'no_product' };
  const prices = await stripe.prices.list({ product: p.id, active: true, limit: 100 });
  const hit = prices.data.find(x => x.currency === currency && x.unit_amount === amount);
  return { sku, ok: !!hit, product: p.id, priceFound: !!hit, priceId: hit?.id || null };
}

// Example usage for the five SKUs you tested:
const items = [
  { sku: 'CYS-Sleeveless', cents: 3500 },
  { sku: 'CYS-Tent-3x3-50mm-Square', cents: 75000 },
  { sku: 'CYS-Tent-3x3-40mm-Square', cents: 67500 },
  { sku: 'CYS-Tent-3x6-40mm-Square', cents: 103000 },
  { sku: 'CYS-Tent-3x6-50mm-Square', cents: 145000 },
];

for (const it of items) {
  const r = await diag(it.sku, 'usd', it.cents);
  console.log(JSON.stringify(r, null, 2));
}
EOF