import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import Stripe from "stripe";
import { Client } from "@notionhq/client";

dotenv.config();

const {
  NOTION_TOKEN,
  NOTION_DB_ID,
  STRIPE_API_KEY_TEST,
  STRIPE_API_KEY_LIVE,
} = process.env;

const CURRENCY = "usd";
const STRIPE_MODE = (process.env.STRIPE_MODE || "live").toLowerCase() === "test" ? "test" : "live";
const STRIPE_KEY  = STRIPE_MODE === "test" ? STRIPE_API_KEY_TEST : STRIPE_API_KEY_LIVE;

if (!NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
if (!NOTION_DB_ID) throw new Error("Missing NOTION_DB_ID");
if (!STRIPE_KEY)   throw new Error(`Missing ${STRIPE_MODE === "test" ? "STRIPE_API_KEY_TEST" : "STRIPE_API_KEY_LIVE"}`);

const notion = new Client({ auth: NOTION_TOKEN });
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2024-06-20" });

/* Map your Notion property names here */
const PROPS = {
  name:  "Product Name",
  sku:   "Product SKU",
  price: "Price",
  active:"Active",
  urlLive: "PaymentURL",
  urlTest: "Stripe Link (Test)",
  image: "Image",            // files (primary)
  v1:    "Variant 1",        // files
  v2:    "Variant 2",
  v3:    "Variant 3",
  v4:    "Variant 4",
  v5:    "Variant 5",
  v6:    "Variant 6",
};

const out = (...a) => console.log("[sync]", ...a);

/* ---------- helpers for Notion properties ---------- */
function asText(prop) {
  if (!prop) return undefined;
  if (prop.type === "title")     return prop.title?.map(t => t.plain_text).join("") || "";
  if (prop.type === "rich_text") return prop.rich_text?.map(t => t.plain_text).join("") || "";
  if (prop.type === "number")    return prop.number;
  if (prop.type === "checkbox")  return !!prop.checkbox;
  if (prop.type === "url")       return prop.url || "";
  return undefined;
}
function asFiles(prop) {
  if (!prop || prop.type !== "files" || !Array.isArray(prop.files)) return [];
  return prop.files.map(f => {
    if (f.type === "external") return { url: f.external.url, name: f.name || "" };
    if (f.type === "file")     return { url: f.file.url,     name: f.name || "" };
    return null;
  }).filter(Boolean);
}

async function* pages(database_id) {
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

/* ---------- Stripe link helpers ---------- */
function lookupKeyFor(sku, price) {
  // stable key so prices are reused
  const cents = Math.round(Number(price || 0) * 100);
  return `sku_${sku}__${cents}_${CURRENCY}`;
}

async function ensurePrice({ sku, price }) {
  const cents = Math.round(Number(price) * 100);
  const lookup_key = lookupKeyFor(sku, price);

  // Try reuse by lookup_key
  const search = await stripe.prices.search({ query: `active:'true' AND lookup_key:'${lookup_key}'` });
  if (search.data?.length) return search.data[0];

  // Else create new price (and new product if needed)
  const p = await stripe.products.create({ name: sku, metadata: { sku } });
  return await stripe.prices.create({
    unit_amount: cents,
    currency: CURRENCY,
    product: p.id,
    lookup_key,
    metadata: { sku }
  });
}

async function ensureStripeLink({ name, sku, price }) {
  const pr = await ensurePrice({ sku, price });
  const links = await stripe.paymentLinks.list({ limit: 10, active: true, expand: [] });

  const found = links.data.find(l =>
    Array.isArray(l.line_items) &&
    l.line_items.length === 1 &&
    l.line_items[0].price === pr.id
  );
  if (found) return found.url;

  const created = await stripe.paymentLinks.create({
    line_items: [{ price: pr.id, quantity: 1 }],
    after_completion: { type: "redirect", redirect: { url: "https://thank.you/" } },
    metadata: { sku },
  });
  return created.url;
}

/* ---------- main ---------- */
async function run() {
  out(`Mode=${STRIPE_MODE}  Currency=${CURRENCY}`);

  const rows = [];

  for await (const page of pages(NOTION_DB_ID)) {
    const props = page.properties || {};
    const name  = asText(props[PROPS.name]);
    const sku   = asText(props[PROPS.sku]);
    const price = asText(props[PROPS.price]);
    const active= asText(props[PROPS.active]);

    if (!name || !sku || typeof price !== "number") {
      out("SKIP (missing fields):", { name, sku, price });
      continue;
    }

    // images/variants from Notion files
    const primary = asFiles(props[PROPS.image]).map(f => ({ url: f.url, alt: name })).slice(0, 1);
    const variants = [
      ...asFiles(props[PROPS.v1]),
      ...asFiles(props[PROPS.v2]),
      ...asFiles(props[PROPS.v3]),
      ...asFiles(props[PROPS.v4]),
      ...asFiles(props[PROPS.v5]),
      ...asFiles(props[PROPS.v6]),
    ].map((f, idx) => ({ label: `Variant ${idx+1}`, url: f.url })).slice(0, 12);

    let link;
    try {
      const safeName = String(name).slice(0, 80);
      link = await ensureStripeLink({ name: safeName, sku, price });
    } catch (e) {
      out(`Stripe error for ${sku}: ${e.message}`);
      link = "";
    }

    rows.push({
      id: page.id.replace(/-/g, ""),
      name,
      sku,
      price,
      currency: CURRENCY,
      link,
      mode: STRIPE_MODE,
      active: !!active,
      images: primary,     // [{url, alt}]
      variants             // [{label,url}]
    });
  }

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(path.join("data", "products.json"), JSON.stringify(rows, null, 2), "utf8");
  out(`Done. ${rows.length} product(s) processed. Wrote data/products.json`);
}

run().catch(err => { console.error(err); process.exit(1); });