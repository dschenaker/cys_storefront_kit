// scripts/sync_simple.mjs
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client as Notion } from '@notionhq/client';
import Stripe from 'stripe';

const {
  NOTION_TOKEN,
  NOTION_DB_ID,
  STRIPE_API_KEY_LIVE,
  STRIPE_API_KEY_TEST,
  STRIPE_MODE = 'live',
  CURRENCY = 'usd',
} = process.env;

function fail(msg) { console.error(msg); process.exit(1); }

// ---- Guardrails
if (!NOTION_TOKEN) fail('Missing NOTION_TOKEN in .env');
if (!NOTION_DB_ID) fail('Missing NOTION_DB_ID in .env');

const stripeKey = STRIPE_MODE === 'test' ? STRIPE_API_KEY_TEST : STRIPE_API_KEY_LIVE;
if (!stripeKey) fail(`Missing ${STRIPE_MODE === 'test' ? 'STRIPE_API_KEY_TEST' : 'STRIPE_API_KEY_LIVE'} in .env`);

const notion = new Notion({ auth: NOTION_TOKEN });
const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

// ---- Config: map your Notion property names here if different
const PROPS = {
  name:          'Product Name',
  active:        'Active',
  price:         'Price',
  sku:           'Product SKU',
  urlLive:       'PaymentURL',
  urlTest:       'Stripe Link (Test)'
};

// ---- Helpers
const out = (...a) => console.log('[sync]', ...a);

async function* iterateDatabase(database_id) {
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id, start_cursor: cursor, page_size: 100,
      filter: { property: PROPS.active, checkbox: { equals: true } }
    });
    for (const r of resp.results) yield r;
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}

function getPlain(prop) {
  if (!prop) return undefined;
  if (prop.type === 'title' || prop.type === 'rich_text') {
    const arr = prop[prop.type] || [];
    return arr.map(t => t.plain_text).join('').trim();
  }
  if (prop.type === 'number') return prop.number ?? undefined;
  if (prop.type === 'url') return prop.url ?? undefined;
  if (prop.type === 'checkbox') return !!prop.checkbox;
  return undefined;
}

function setUrlProperty(value) {
  return value ? { url: value } : { url: null };
}

// Create-or-get Stripe Product/Price/PaymentLink
async function ensureStripeLink({ name, sku, price, mode }) {
  const isTest = mode === 'test';

  // 1) Product
  // Try to find by metadata.sku to avoid dupes
  let product;
  const search = await stripe.products.search({ query: `metadata['sku']:'${sku}'` }).catch(() => null);
  if (search && search.data.length) {
    product = search.data[0];
  } else {
    product = await stripe.products.create({
      name, active: true,
      metadata: { sku }
    });
  }

  // 2) Price (reuse existing exact-matching active price if found)
  let priceObj;
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  priceObj = prices.data.find(p => p.unit_amount === Math.round(price * 100) && p.currency === CURRENCY);
  if (!priceObj) {
    priceObj = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(price * 100),
      currency: CURRENCY
    });
  }

  // 3) Payment Link (create fresh for idempotent demo; could cache by price id)
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: priceObj.id, quantity: 1 }],
    allow_promotion_codes: false,
    metadata: { sku, source: 'notion-sync', mode }
  });

  return link.url;
}

async function updateNotionUrl(pageId, propName, url) {
  await notion.pages.update({
    page_id: pageId,
    properties: { [propName]: { url } }
  });
}

async function run() {
  out(`Mode=${STRIPE_MODE}, Currency=${CURRENCY}`);
  const records = [];
  for await (const page of iterateDatabase(NOTION_DB_ID)) {
    const p = page.properties;
    const name = getPlain(p[PROPS.name]);
    const active = getPlain(p[PROPS.active]);
    const price = getPlain(p[PROPS.price]);
    const sku = getPlain(p[PROPS.sku]);
    const urlLive = getPlain(p[PROPS.urlLive]);
    const urlTest = getPlain(p[PROPS.urlTest]);

    if (!name || !sku || typeof price !== 'number') {
      out(`SKIP (missing fields):`, { name, sku, price });
      continue;
    }

    // Make/refresh Stripe link for current mode
    let newUrl;
    try {
      newUrl = await ensureStripeLink({ name, sku, price, mode: STRIPE_MODE });
    } catch (e) {
      out(`Stripe error for SKU=${sku}:`, e.message);
      continue;
    }

    // Write back to the correct column
    const targetProp = STRIPE_MODE === 'test' ? PROPS.urlTest : PROPS.urlLive;
    try {
      await updateNotionUrl(page.id, targetProp, newUrl);
    } catch (e) {
      out(`Notion update failed for SKU=${sku}:`, e.message);
    }

    // Collect for products.json
    records.push({
      id: page.id,
      name, sku, price, currency: CURRENCY,
      link: newUrl,
      mode: STRIPE_MODE,
      active: !!active
    });
  }

  // Write data/products.json
  const dataDir = path.join(process.cwd(), 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'products.json'), JSON.stringify(records, null, 2), 'utf8');

  out(`Done. ${records.length} product(s) processed. Wrote data/products.json`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});