// scripts/diag_links.mjs
// Minimal: check which SKUs have a Price (by lookup_key = sku). No Stripe Search.

import 'dotenv/config';
import Stripe from 'stripe';
import fs from 'fs';

const MODE = (process.env.STRIPE_MODE || 'live').toLowerCase();
const KEY  = MODE === 'live' ? process.env.STRIPE_API_KEY_LIVE : process.env.STRIPE_API_KEY_TEST;
if (!KEY) {
  console.error(`Missing Stripe key for MODE=${MODE}. Set STRIPE_API_KEY_${MODE.toUpperCase()}.`);
  process.exit(1);
}
const stripe = new Stripe(KEY, { apiVersion: '2024-06-20' });

// Load products.json
const rows = JSON.parse(fs.readFileSync('data/products.json', 'utf8'));

// tiny wait to avoid endpoint-concurrency rate limits
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function findPriceByLookup(sku) {
  // simplest supported iteration: the list() result is async-iterable
  const list = stripe.prices.list({ lookup_keys: [sku], active: true, limit: 1, expand: ['data.product'] });

  for await (const price of list) {
    return price ?? null;
  }
  return null;
}

async function safeCheck(sku) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const price = await findPriceByLookup(sku);
      return {
        sku, ok: !!price, mode: MODE,
        price_id: price?.id || null,
        product_id: price?.product?.id || null,
        amount: price?.unit_amount || null,
        currency: price?.currency || null,
      };
    } catch (e) {
      if (e.code === 'rate_limit') {
        await sleep(600 + attempts * 400); // gentle backoff
        continue;
      }
      return { sku, ok: false, mode: MODE, type: e.type || e.name, message: e.message };
    }
  }
  return { sku, ok: false, mode: MODE, type: 'rate_limit', message: 'Gave up after retries' };
}

(async () => {
  for (const r of rows) {
    if (!r?.sku) continue;
    const res = await safeCheck(r.sku);
    console.log(JSON.stringify(res, null, 2));
    await sleep(120); // tiny spacing between requests
  }
})();