// scripts/sync_simple.mjs
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { Client } from '@notionhq/client';
import Stripe from 'stripe';

const {
  NOTION_TOKEN,
  NOTION_DB_ID,
  STRIPE_API_KEY_TEST,
  STRIPE_API_KEY_LIVE,
} = process.env;

const STRIPE_MODE = (process.env.STRIPE_MODE || 'live').toLowerCase(); // 'test'|'live'
const CURRENCY = 'usd';

if (!NOTION_TOKEN || !NOTION_DB_ID) {
  console.error('Missing NOTION_TOKEN or NOTION_DB_ID in .env');
  process.exit(1);
}
if (STRIPE_MODE === 'test' && !STRIPE_API_KEY_TEST) {
  console.error('Missing STRIPE_API_KEY_TEST in .env');
  process.exit(1);
}
if (STRIPE_MODE === 'live' && !STRIPE_API_KEY_LIVE) {
  console.error('Missing STRIPE_API_KEY_LIVE in .env');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const stripe = new Stripe(
  STRIPE_MODE === 'test' ? STRIPE_API_KEY_TEST : STRIPE_API_KEY_LIVE,
  { apiVersion: '2024-06-20' }
);

// Property name aliases so we work with your current Notion schema
const PROPS = {
  name: ['Product Name', 'Name', 'Title'],
  active: ['Active', 'Enabled'],
  price: ['Price', 'Unit Price'],
  sku: ['Product SKU', 'SKU'],
  urlLive: ['PaymentURL', 'Payment Link', 'Stripe Link (Live)', 'Stripe Link'],
  urlTest: ['Stripe Link (Test)', 'Payment Link (Test)'],
  image: ['Image URL', 'Image', 'Images', 'Photo'],       // URL or Files
  variants: ['Variants', 'Options', 'Sizes', 'Styles'],   // multi_select or text
};

function getPropKey(obj, aliases) {
  for (const k of aliases) if (obj[k]) return k;
  return null;
}
function pick(obj, aliases) {
  const k = getPropKey(obj, aliases);
  return k ? obj[k] : undefined;
}
function plain(p) {
  if (!p) return undefined;
  if (p.type === 'title' || p.type === 'rich_text') {
    return (p[p.type] || []).map(t => t.plain_text).join('');
  }
  if (p.type === 'checkbox') return !!p.checkbox;
  if (p.type === 'number') return p.number;
  if (p.type === 'url') return p.url || undefined;
  if (p.type === 'select') return p.select?.name;
  if (p.type === 'multi_select') return (p.multi_select || []).map(s => s.name);
  if (p.type === 'files') {
    const f = (p.files || [])[0];
    if (!f) return undefined;
    if (f.type === 'external') return f.external.url;
    if (f.type === 'file') return f.file.url; // Notion-signed (time-limited)
  }
  return undefined;
}

async function* readAll(database_id) {
  let cursor;
  do {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: 'Active', checkbox: { equals: true } }, // safe default
    });
    for (const r of resp.results) yield r;
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
}

// We’re not auto-creating Stripe links here; you already have them.
// Stub is left for future upsert if needed.
async function ensureStripeLink() { return undefined; }

function imageFrom(props) {
  const p = pick(props, PROPS.image);
  const v = plain(p);
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v; // if multi_select accidentally used
}
function variantsFrom(props) {
  const p = pick(props, PROPS.variants);
  const v = plain(p);
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v.split(/[,|]/).map(s => s.trim()).filter(Boolean);
}

async function run() {
  console.log(`[sync] Mode=${STRIPE_MODE}  Currency=${CURRENCY}`);

  const out = [];

  for await (const page of readAll(NOTION_DB_ID)) {
    const props = page.properties || {};

    const name   = plain(pick(props, PROPS.name));
    const active = !!plain(pick(props, PROPS.active));
    const price  = plain(pick(props, PROPS.price));
    const sku    = plain(pick(props, PROPS.sku));
    if (!active || !name || !sku || typeof price !== 'number') continue;

    const urlLive = plain(pick(props, PROPS.urlLive));
    const urlTest = plain(pick(props, PROPS.urlTest));
    const link = (STRIPE_MODE === 'test' ? urlTest : urlLive) || null;

    out.push({
      id: page.id,
      name,
      sku,
      price,
      currency: CURRENCY,
      link,
      mode: STRIPE_MODE,
      active: true,
      image: imageFrom(props) || null,
      variants: variantsFrom(props),
    });
  }

  await fs.mkdir(path.join('data'), { recursive: true });
  await fs.writeFile(path.join('data', 'products.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`Done. ${out.length} product(s) processed. Wrote data/products.json`);
}

run().catch(e => { console.error(e); process.exit(1); });