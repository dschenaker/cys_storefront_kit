// scripts/sync_simple.mjs
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import Stripe from 'stripe';
import { Client } from '@notionhq/client';

const STRIPE_MODE = (process.env.STRIPE_MODE || 'live').toLowerCase();
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();

const STRIPE_KEY = STRIPE_MODE === 'live' ? process.env.STRIPE_API_KEY_LIVE : process.env.STRIPE_API_KEY_TEST;
if (!STRIPE_KEY) {
  console.error(`Missing Stripe key: STRIPE_API_KEY_${STRIPE_MODE.toUpperCase()}`);
  process.exit(1);
}
const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error('Missing NOTION_TOKEN or NOTION_DB_ID.');
  process.exit(1);
}
const notion = new Client({ auth: NOTION_TOKEN });

const PROPS = {
  name: 'Product Name',
  price: 'Price',
  sku: 'Product SKU',
  active: 'Active',
  urlLive: 'PaymentURL',
  urlTest: 'Stripe Link (Test)',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getPlain(p) {
  if (!p) return undefined;
  if (p.type === 'title' || p.type === 'rich_text') return (p[p.type] || []).map(t => t.plain_text).join('');
  if (p.type === 'url') return p.url || undefined;
  if (p.type === 'checkbox') return !!p.checkbox;
  if (p.type === 'number') return p.number ?? undefined;
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

async function ensureProduct({ name, sku }) {
  // Try to find existing product via list() (keeps things simple + compatible)
  const list = stripe.products.list({ active: true, limit: 100 });
  for await (const p of list) {
    if (p.metadata?.sku === sku || p.name === name) return p;
  }
  const safe = String(name).slice(0, 80);
  return stripe.products.create({ name: safe, active: true, metadata: { sku } });
}

async function ensurePrice({ productId, sku, amount, currency }) {
  // First: find by lookup_key (the stable pointer)
  const prices = stripe.prices.list({ product: productId, active: true, lookup_keys: [sku], currency, limit: 100 });
  for await (const pr of prices) {
    if (pr.lookup_key === sku) return pr;
  }
  // If not found, create a new one with lookup_key = sku
  return stripe.prices.create({
    currency,
    unit_amount: Math.round(Number(amount) * 100),
    product: productId,
    active: true,
    lookup_key: sku,
  });
}

async function ensurePaymentLink({ priceId }) {
  // Reuse link for the same price if one exists
  const links = stripe.paymentLinks.list({ active: true, limit: 100 });
  for await (const l of links) {
    const li = l.line_items?.data?.[0];
    if (li?.price === priceId) return l;
  }
  return stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: 'redirect', redirect: { url: 'https://stripe.com/thanks' } },
  });
}

async function ensureStripeLink({ name, sku, price, currency }) {
  const product = await ensureProduct({ name, sku });
  await sleep(100);
  const pr = await ensurePrice({ productId: product.id, sku, amount: price, currency });
  await sleep(100);
  const link = await ensurePaymentLink({ priceId: pr.id });
  return link.url;
}

function out(...args) { console.log('[sync]', ...args); }

async function run() {
  out(`Mode=${STRIPE_MODE}  Currency=${CURRENCY}`);
  const rows = [];

  for await (const page of readAll(NOTION_DB_ID)) {
    const props = page.properties || {};
    const name = getPlain(props[PROPS.name]);
    const active = getPlain(props[PROPS.active]);
    const price = getPlain(props[PROPS.price]);
    const sku = getPlain(props[PROPS.sku]);

    if (!name || !sku || typeof price !== 'number') {
      out('SKIP (missing fields):', { name, sku, price });
      continue;
    }

    let url;
    try {
      const safeName = String(name).slice(0, 80);
      url = await ensureStripeLink({ name: safeName, sku, price, currency: CURRENCY });
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

    // small spacing to be kind to Stripe’s concurrency limiter
    await sleep(120);
  }

  await fs.mkdir(path.join('data'), { recursive: true });
  await fs.writeFile(path.join('data', 'products.json'), JSON.stringify(rows, null, 2), 'utf8');
  out(`Done. ${rows.length} product(s) processed. Wrote data/products.json`);
}

run().catch(err => { console.error(err); process.exit(1); });