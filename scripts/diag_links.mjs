// scripts/diag_links.mjs
// Quick checker for missing Stripe links using LOOKUP KEY only (no unit_amount searches)

import 'dotenv/config';
import Stripe from 'stripe';

const MODE = (process.env.STRIPE_MODE || process.env.STRIPE_ENV || 'test').toLowerCase();
const KEY  = MODE === 'live' ? process.env.STRIPE_API_KEY_LIVE : process.env.STRIPE_API_KEY_TEST;
if (!KEY) {
  console.error(`Missing Stripe key for MODE=${MODE}. Set STRIPE_API_KEY_${MODE.toUpperCase()}.`);
  process.exit(1);
}
const stripe = new Stripe(KEY, { apiVersion: '2024-06-20' });

import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('data/products.json', 'utf8'));

function out(obj){ console.log(JSON.stringify(obj, null, 2)); }

async function findPriceByLookup(lookup_key) {
  // Prefer prices.list with lookup_keys filter (stable & supported)
  const iter = stripe.prices.list({ limit: 100, lookup_keys: [lookup_key], active: true, expand: ['data.product'] });
  const prices = [];
  for await (const p of iter.autoPagingEach ? iter.autoPagingEach() : iter) prices.push(p);
  return prices[0] || null;
}

(async () => {
  for (const r of rows) {
    const sku = r.sku;
    if (!sku) continue;

    try {
      const price = await findPriceByLookup(sku);
      out({
        sku,
        ok: !!price,
        mode: MODE,
        price_id: price?.id || null,
        product_id: price?.product?.id || null,
        amount: price?.unit_amount || null,
        currency: price?.currency || null,
      });
    } catch (e) {
      out({ sku, ok:false, mode: MODE, type: e.type || e.name, message: e.message });
    }
  }
})();