#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import Stripe from 'stripe';
import { Client } from '@notionhq/client';

// ====== ENV ======
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const MODE         = (process.env.STRIPE_MODE || 'live').toLowerCase(); // 'test' or 'live'
const CURRENCY     = (process.env.CURRENCY || 'usd').toLowerCase();
const STRIPE_KEY   = MODE === 'test' ? process.env.STRIPE_API_KEY_TEST : process.env.STRIPE_API_KEY_LIVE;

if (!NOTION_TOKEN || !NOTION_DB_ID || !STRIPE_KEY) {
  console.error('Missing NOTION_TOKEN, NOTION_DB_ID, or Stripe keys.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' });
const notion = new Client({ auth: NOTION_TOKEN });

// ====== Notion property names (adjust if you renamed columns) ======
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

// ====== helpers ======
function getPlain(prop) {
  if (!prop) return undefined;
  if (prop.type === 'title' || prop.type === 'rich_text') {
    return prop[prop.type].map(t => t.plain_text).join('');
  }
  if (prop.type === 'checkbox') return !!prop.checkbox;
  if (prop.type === 'number')   return prop.number;
  if (prop.type === 'url')      return prop.url;
  if (prop.type === 'select')   return prop.select?.name;
  if (prop.type === 'status')   return prop.status?.name;
  return undefined;
}

function notionFiles(prop) {
  if (!prop || prop.type !== 'files' || !Array.isArray(prop.files)) return [];
  return prop.files.map(f => f.external?.url || f.file?.url).filter(Boolean);
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

function safeSlug(s){
  return String(s || '')
    .replace(/[^\w.-]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .slice(0,80);
}

function extFrom(contentType, url){
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return '.jpg';
  if (contentType?.includes('webp')) return '.webp';
  const m = String(url).match(/\.(png|jpg|jpeg|webp)(\?|$)/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

async function fetchBuffer(u){
  const r = await fetch(u);
  if (!r.ok) throw new Error(`fetch ${u} ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get('content-type') || '';
  return { buf, type };
}

async function cacheImagesForSKU(sku, urls){
  const baseDir = path.join('assets','products', safeSlug(sku));
  await fs.mkdir(baseDir, { recursive: true });
  const out = [];
  let i = 1;
  for (const u of urls){
    try{
      const { buf, type } = await fetchBuffer(u);
      const ext = extFrom(type, u);
      const name = String(i).padStart(2,'0') + ext;
      const rel = path.join('assets','products', safeSlug(sku), name).replaceAll('\\','/');
      await fs.writeFile(path.join(baseDir, name), buf);
      out.push(rel);
      i++;
      await sleep(80); // be gentle
    }catch(e){
      console.log(`image cache fail ${sku}: ${e.message}`);
    }
  }
  return out;
}

// Stripe product/price/payment link, idempotent via lookup keys
async function ensureStripeLink({ name, sku, price, currency }) {
  const productLookup = `prod_${sku}`;
  const priceLookup   = `price_${sku}_${currency}_${Math.round(price*100)}`;

  // Product
  let product;
  try {
    const list = await stripe.products.search({ query: `active:'true' AND metadata['lookup_key']:'${productLookup}'` });
    if (list.data[0]) product = list.data[0];
  } catch {}
  if (!product) {
    product = await stripe.products.create({
      name: String(name).slice(0,80),
      active: true,
      metadata: { lookup_key: productLookup, sku }
    });
  }

  // Price
  let priceObj;
  try {
    const list = await stripe.prices.search({ query: `active:'true' AND lookup_keys:'${priceLookup}'` });
    if (list.data[0]) priceObj = list.data[0];
  } catch {}
  if (!priceObj) {
    priceObj = await stripe.prices.create({
      currency,
      unit_amount: Math.round(price*100),
      product: product.id,
      lookup_key: priceLookup,
      active: true
    });
  }

  // Payment link
  let link;
  try {
    const list = await stripe.paymentLinks.list({ limit: 100 });
    link = list.data.find(l => l.metadata?.sku === sku);
  } catch {}
  if (!link) {
    for (let tries=0; tries<3; tries++){
      try {
        link = await stripe.paymentLinks.create({
          line_items: [{ price: priceObj.id, quantity: 1 }],
          metadata: { sku }
        });
        break;
      } catch (e) {
        if (e?.statusCode === 429) { await sleep(600 * (tries+1)); continue; }
        throw e;
      }
    }
  }

  return link?.url;
}

// ====== MAIN ======
(async ()=>{
  console.log(`[sync] Mode=${MODE}  Currency=${CURRENCY}`);
  const rows = [];

  for await (const page of readAll(NOTION_DB_ID)) {
    const pr = page.properties || {};
    const name   = getPlain(pr[PROPS.name]);
    const active = getPlain(pr[PROPS.active]);
    const price  = getPlain(pr[PROPS.price]);
    const sku    = getPlain(pr[PROPS.sku]);

    if (!name || !sku || typeof price !== 'number') {
      console.log('SKIP (missing fields):', { name, sku, price });
      continue;
    }

    const notionImageURLs = [
      ...notionFiles(pr[PROPS.image]),
      ...notionFiles(pr[PROPS.var1]),
      ...notionFiles(pr[PROPS.var2]),
    ];

    // Stripe link
    let url;
    try {
      url = await ensureStripeLink({ name: String(name).slice(0,80), sku, price, currency: CURRENCY });
    } catch (e) {
      console.log(`Stripe error for ${sku}: ${e.message}`);
      continue;
    }

    // Write URL back to Notion
    const targetProp = MODE === 'test' ? PROPS.urlTest : PROPS.urlLive;
    try {
      await notion.pages.update({ page_id: page.id, properties: { [targetProp]: { url } } });
    } catch (e) {
      console.log(`Notion update failed for ${sku}: ${e.message}`);
    }

    // Cache images locally and use repo paths
    const localImages = await cacheImagesForSKU(sku, notionImageURLs);

    rows.push({
      id: page.id,
      name,
      sku,
      price,
      currency: CURRENCY,
      link: url,
      mode: MODE,
      active: !!active,
      images: localImages
    });
  }

  await fs.mkdir('data', { recursive: true });
  await fs.writeFile(path.join('data','products.json'), JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Done. ${rows.length} product(s) processed. Wrote data/products.json`);
})().catch(err => { console.error(err); process.exit(1); });