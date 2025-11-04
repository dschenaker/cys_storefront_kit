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

if (!NOTION_TOKEN) fail('Missing NOTION_TOKEN in .env');
if (!NOTION_DB_ID) fail('Missing NOTION_DB_ID in .env');

const stripeKey = STRIPE_MODE === 'test' ? STRIPE_API_KEY_TEST : STRIPE_API_KEY_LIVE;
if (!stripeKey) fail(`Missing ${STRIPE_MODE === 'test' ? 'STRIPE_API_KEY_TEST' : 'STRIPE_API_KEY_LIVE'} in .env`);

const notion = new Notion({ auth: NOTION_TOKEN });
const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

// Map your Notion property names here if different
const PROPS = {
  name:          'Product Name',
  active:        'Active',
  price:         'Price',
  sku:           'Product SKU',
  urlLive:       'PaymentURL',
  urlTest:       'Stripe Link (Test)',
};

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

async function ensureStripeLink({ name, sku, price, currency, mode }) {
  // Product (dedupe by metadata.sku)
  let product;
  const found = await stripe.products.search({ query: `metadata['sku']:'${sku}'` }).catch(() => null);
  product = (found && found.data[0]) || await stripe.products.create({
    name, active: true, metadata: { sku }
  });

  // Price (reuse exact matching active price)
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  let priceObj = prices.data.find(p => p.unit_amount === Math.round(price * 100) && p.currency === currency);
  if (!priceObj) {
    priceObj = await stripe.prices.create({
      product: product.id, unit_amount: Math.round(price * 100), currency
    });
  }

  // Payment link
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: priceObj.id, quantity: 1 }],
    metadata: { sku, source: 'notion-sync', mode }
  });

  return link.url;
}

async function run() {
  out(`Mode=${STRIPE_MODE}  Currency=${CURRENCY}`);
  const rows = [];

  for await (const page of iterateDatabase(NOTION_DB_ID)) {
    const p = page.properties;
    const name   = getPlain(p[PROPS.name]);
    const active = getPlain(p[PROPS.active]);
    const price  = getPlain(p[PROPS.price]);
    const sku    = getPlain(p[PROPS.sku]);

    if (!name || !sku || typeof price !== 'number') {
      out('SKIP (missing fields):', { name, sku, price });
      continue;
    }

    let url;
    try {
      url = await ensureStripeLink({ name, sku, price, currency: CURRENCY, mode: STRIPE_MODE });
    } catch (e) {
      out(`Stripe error for ${sku}: ${e.message}`);
      continue;
    }

    const targetProp = STRIPE_MODE === 'test' ? PROPS.urlTest : PROPS.urlLive;
    try {
      await notion.pages.update({ page_id: page.id, properties: { [targetProp]: { url } } });
    } catch (e) {
      out(`Notion update failed for ${sku}: ${e.message}`);
    }

    rows.push({ id: page.id, name, sku, price, currency: CURRENCY, link: url, mode: STRIPE_MODE, active: !!active });
  }

  // Write products.json for your site
  await fs.mkdir(path.join('data'), { recursive: true });
  await fs.writeFile(path.join('data', 'products.json'), JSON.stringify(rows, null, 2), 'utf8');
  out(`Done. ${rows.length} product(s) processed. Wrote data/products.json`);
}

run().catch(err => { console.error(err); process.exit(1); });
