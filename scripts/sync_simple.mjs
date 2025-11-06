#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import Stripe from 'stripe';
import { Client } from '@notionhq/client';

const NOTION_TOKEN     = process.env.NOTION_TOKEN;
const NOTION_DB_ID     = process.env.NOTION_DB_ID;
const MODE             = (process.env.STRIPE_MODE || 'live').toLowerCase(); // 'test' or 'live'
const CURRENCY         = (process.env.CURRENCY || 'usd').toLowerCase();

const STRIPE_KEY = MODE === 'test' ? process.env.STRIPE_API_KEY_TEST : process.env.STRIPE_API_KEY_LIVE;
if (!NOTION_TOKEN || !NOTION_DB_ID || !STRIPE_KEY) {
  console.error('Missing required env vars. Need NOTION_TOKEN, NOTION_DB_ID, STRIPE_API_KEY_TEST / STRIPE_API_KEY_LIVE.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });
const notion = new Client({ auth: NOTION_TOKEN });

// Map your Notion property names here:
const PROPS = {
  name:   'Product Name',
  active: 'Active',
  price:  'Price',
  sku:    'Product SKU',
  urlLive:'PaymentURL',
  urlTest:'Stripe Link (Test)',
  image:  'Image',       // files
  var1:   'Variant 1',   // files
  var2:   'Variant 2'    // files
};

function getPlain(prop) {
  if (!prop) return undefined;
  if (prop.type === 'title' || prop.type === 'rich_text') {
    return prop[prop.type].map(t => t.plain_text).join('');
  }
  if (prop.type === 'checkbox') return !!prop.checkbox;
  if (prop.type === 'number')   return prop.number;
  if (prop.type === 'select')   return prop.select?.name;
  if (prop.type === 'url')      return prop.url;
  if (prop.type === 'status')   return prop.status?.name;
  return undefined;
}

function fileUrlsFromNotion(prop) {
  if (!prop || prop.type !== 'files' || !Array.isArray(prop.files)) return [];
  return prop.files
    .map(f => f.external?.url || f.file?.url)
    .filter(Boolean);
}

async function* readAll(database_id) {
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 50,
      filter: { property: PROPS.active, checkbox: { equals: true } }
    });
    for (const r of resp.results) yield r;
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}

async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Create (or reuse) Stripe Product/Price by lookup_key derived from SKU
async function ensureStripeLink({ name, sku, price, currency }) {
  const productLookup = `prod_${sku}`;
  const priceLookup   = `price_${sku}_${currency}_${Math.round(price*100)}`;

  // 1) Product
  let product;
  try {
    const list = await stripe.products.search({ query: `active:'true' AND metadata['lookup_key']:'${productLookup}'` });
    if (list.data[0]) product = list.data[0];
  } catch (_) {}
  if (!product) {
    product = await stripe.products.create({
      name: String(name).slice(0,80),
      active: true,
      metadata: { lookup_key: productLookup, sku }
    });
  }

  // 2) Price (idempotent by lookup_key)
  let priceObj;
  try {
    const list = await stripe.prices.search({ query: `active:'true' AND lookup_keys:'${priceLookup}'` });
    if (list.data[0]) priceObj = list.data[0];
  } catch (_) {}
  if (!priceObj) {
    priceObj = await stripe.prices.create({
      currency,
      unit_amount: Math.round(price*100),
      product: product.id,
      lookup_key: priceLookup,
      active: true
    });
  }

  // 3) Payment link (idempotent-ish by metadata)
  let link;
  try {
    const list = await stripe.paymentLinks.list({ limit: 100 });
    link = list.data.find(l => l.metadata && l.metadata.sku === sku);
  } catch (_) {}
  if (!link) {
    // tiny backoff guard against concurrency/rate limits
    for (let tries=0; tries<3; tries++){
      try {
        link = await stripe.paymentLinks.create({
          line_items: [{ price: priceObj.id, quantity: 1 }],
          metadata: { sku }
        });
        break;
      } catch (e) {
        if (e?.statusCode === 429) { await sleep(700 * (tries+1)); continue; }
        throw e;
      }
    }
  }

  return link?.url;
}

async function main(){
  console.log(`[sync] Mode=${MODE}  Currency=${CURRENCY}`);
  const rows = [];

  for await (const page of readAll(NOTION_DB_ID)) {
    const p = page.properties || {};
    const name   = getPlain(p[PROPS.name]);
    const active = getPlain(p[PROPS.active]);
    const price  = getPlain(p[PROPS.price]);
    const sku    = getPlain(p[PROPS.sku]);

    if (!name || !sku || typeof price !== 'number') {
      console.log('SKIP (missing fields):', { name, sku, price });
      continue;
    }

    const images = [
      ...fileUrlsFromNotion(p[PROPS.image]),
      ...fileUrlsFromNotion(p[PROPS.var1]),
      ...fileUrlsFromNotion(p[PROPS.var2])
    ];

    let url;
    try {
      url = await ensureStripeLink({ name: String(name).slice(0,80), sku, price, currency: CURRENCY });
    } catch (e) {
      console.log(`Stripe error for ${sku}: ${e.message}`);
      continue;
    }

    const targetProp = MODE === 'test' ? PROPS.urlTest : PROPS.urlLive;
    try {
      await notion.pages.update({ page_id: page.id, properties: { [targetProp]: { url } } });
    } catch (e) {
      console.log(`Notion update failed for ${sku}: ${e.message}`);
    }

    rows.push({
      id: page.id,
      name,
      sku,
      price,
      currency: CURRENCY,
      link: url,
      mode: MODE,
      active: !!active,
      images
    });
  }

  await fs.mkdir(path.join('data'), { recursive: true });
  await fs.writeFile(path.join('data','products.json'), JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Done. ${rows.length} product(s) processed. Wrote data/products.json`);
}

main().catch(err => { console.error(err); process.exit(1); });