cat > scripts/sync_simple.mjs <<'EOF'
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import Stripe from 'stripe';
import { Client as Notion } from '@notionhq/client';

const STRIPE_MODE = (process.env.STRIPE_MODE || 'live').toLowerCase(); // 'test' | 'live'
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const STRIPE_API_KEY =
  STRIPE_MODE === 'test' ? process.env.STRIPE_API_KEY_TEST : process.env.STRIPE_API_KEY_LIVE;

if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
if (!NOTION_DB_ID) throw new Error('Missing NOTION_DB_ID');
if (!STRIPE_API_KEY) throw new Error(`Missing STRIPE_API_KEY for mode=${STRIPE_MODE}`);

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });
const notion = new Notion({ auth: NOTION_TOKEN });

// --- Helpers ---
const PROPS = {
  name: 'Product Name',
  active: 'Active',
  price: 'Price',
  sku: 'Product SKU',
  urlLive: 'PaymentURL',
  urlTest: 'Stripe Link (Test)',
};

function getPlain(p) {
  if (!p) return undefined;
  if (p.type === 'title' || p.type === 'rich_text') {
    return (p[p.type] || []).map(t => t.plain_text).join('');
  }
  if (p.type === 'number') return p.number;
  if (p.type === 'checkbox') return !!p.checkbox;
  if (p.type === 'url') return p.url || undefined;
  if (p.type === 'select') return p.select?.name;
  if (p.type === 'multi_select') return (p.multi_select || []).map(x => x.name);
  return undefined;
}

async function* readAll(database_id) {
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: PROPS.active, checkbox: { equals: true } },
    });
    for (const r of resp.results) yield r;
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}

// --- Stripe upserts (no search by unit_amount) ---
async function ensureProduct({ sku, name }) {
  // Prefer search by metadata.sku if available; fallback list (small catalogs)
  let prodId = null;
  try {
    const res = await stripe.products.search({
      query: `active:'true' AND metadata['sku']:'${sku.replace(/'/g, "\\'")}'`,
      limit: 1,
    });
    if (res?.data?.[0]) prodId = res.data[0].id;
  } catch {
    // search not available or metadata filter disabled; ignore
  }

  if (!prodId) {
    // try list then filter by metadata
    const list = await stripe.products.list({ active: true, limit: 100 });
    const hit = list.data.find(p => p.metadata?.sku === sku);
    if (hit) prodId = hit.id;
  }

  if (prodId) return prodId;

  const created = await stripe.products.create({
    name: String(name).slice(0, 80),
    active: true,
    metadata: { sku },
  });
  return created.id;
}

async function ensurePrice({ product, amount, currency }) {
  // Stripe doesn't let us search prices by unit_amount; list and filter in JS.
  const prices = await stripe.prices.list({ product, active: true, limit: 100 });
  const found = prices.data.find(p => p.currency === currency && p.unit_amount === amount);
  if (found) return found.id;

  const lookup_key = `${product}:${currency}:${amount}`;
  const created = await stripe.prices.create({
    product,
    currency,
    unit_amount: amount,
    lookup_key,
    // one-off (not recurring)
  });
  return created.id;
}

async function createPaymentLink({ priceId }) {
  // Simple: create a new Payment Link pointing at that price.
  // (We don't try to de-duplicate links; Notion will hold the latest URL.)
  const pl = await stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: 'redirect', redirect: { url: 'https://thankyou.invalid/' } },
    metadata: { source: 'notion_storefront_kit' },
  });
  return pl.url;
}

async function ensureStripeLink({ name, sku, price, currency }) {
  const cents = Math.round(Number(price) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error('Bad price');

  const productId = await ensureProduct({ sku, name });
  const priceId = await ensurePrice({ product: productId, amount: cents, currency });
  const url = await createPaymentLink({ priceId });
  return url;
}

// --- Main ---
console.log(`[sync] Mode=${STRIPE_MODE}  Currency=${CURRENCY}`);

const rows = [];
for await (const page of readAll(NOTION_DB_ID)) {
  const props = page.properties || {};
  const name = getPlain(props[PROPS.name]);
  const active = getPlain(props[PROPS.active]);
  const price = getPlain(props[PROPS.price]);
  const sku = getPlain(props[PROPS.sku]);

  if (!name || !sku || typeof price !== 'number') {
    console.log('SKIP (missing fields):', { name, sku, price });
    continue;
  }

  let url;
  try {
    const safeName = String(name).slice(0, 80);
    url = await ensureStripeLink({ name: safeName, sku, price, currency: CURRENCY });
  } catch (e) {
    console.log(`Stripe error for ${sku}: ${e.message}`);
    continue;
  }

  const targetProp = STRIPE_MODE === 'test' ? PROPS.urlTest : PROPS.urlLive;
  try {
    await notion.pages.update({ page_id: page.id, properties: { [targetProp]: { url } } });
  } catch (e) {
    console.log(`Notion update failed for ${sku}: ${e.message}`);
  }

  rows.push({ id: page.id, name, sku, price, currency: CURRENCY, link: url, mode: STRIPE_MODE, active: !!active });
}

// Write products.json for site
await fs.mkdir(path.join('data'), { recursive: true });
await fs.writeFile(path.join('data', 'products.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`Done. ${rows.length} product(s) processed. Wrote data/products.json`);
EOF