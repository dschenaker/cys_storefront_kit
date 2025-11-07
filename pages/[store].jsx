import fs from "fs";
import path from "path";
import Head from "next/head";
import { useRouter } from "next/router";
import React from "react";

// ----- helpers -----
function readJSON(relPath) {
  const p = path.join(process.cwd(), "public", relPath);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function withBase(basePath, p) {
  if (!p) return "";
  // absolute (https) or already basePath-prefixed
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith(basePath + "/")) return p;
  if (p.startsWith("/")) return basePath + p; // absolute to basePath
  return basePath + "/" + p.replace(/^\.\//, "");
}

function filterProducts(all, client) {
  const allow = new Set(client.sku_allowlist || []);
  const prefixes = client.sku_prefixes || [];
  return all.filter((p) => {
    if (allow.size && allow.has(p.sku)) return true;
    if (prefixes.length && prefixes.some((pre) => p.sku?.startsWith(pre))) return true;
    // if neither allowlist nor prefixes provided, show nothing (strict mode)
    return false;
  });
}

// ----- page -----
export default function StorePage({ store, client, products, basePath }) {
  const router = useRouter();
  const brand = client.brand || {};
  const heroUrl = withBase(basePath, brand.hero || "");
  const logoUrl = withBase(basePath, brand.logo || "");
  const primary = brand.primary || brand.accent || "#0f172a";
  const text = brand.text || "#e7f3ea";
  const bg1 = brand.bg1 || "#0b1316";
  const bg2 = brand.bg2 || "#0f1a1f";

  return (
    <>
      <Head>
        <title>{client.name || store} — Storefront</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx global>{`
        :root {
          --primary: ${primary};
          --text: ${text};
          --bg1: ${bg1};
          --bg2: ${bg2};
        }
        html, body {
          margin: 0;
          background: linear-gradient(180deg, var(--bg1), var(--bg2));
          color: var(--text);
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif;
        }
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 16px;
        }
        .hero {
          width: 100%;
          min-height: 180px;
          background-image: url("${heroUrl || ""}");
          background-size: cover;
          background-position: center;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.08);
          display: flex;
          align-items: center;
          padding: 16px;
          box-sizing: border-box;
          margin: 14px 0 18px;
        }
        .brand {
          display: flex; gap: 14px; align-items: center;
          background: rgba(0,0,0,.35);
          padding: 10px 14px; border-radius: 12px; backdrop-filter: blur(4px);
        }
        .brand img { height: 52px; width: auto; border-radius: 10px; }
        h1 { margin: 0; font-size: 22px; letter-spacing: .2px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 16px;
        }
        .card {
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 14px;
          overflow: hidden;
        }
        .thumb {
          height: 180px;
          background: rgba(0,0,0,.25);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .thumb img {
          max-height: 170px;
          max-width: 95%;
          object-fit: contain;
          display: block;
        }
        .card-body { padding: 14px 16px 16px; }
        .card-title { font-weight: 700; margin-bottom: 6px; }
        .sku { opacity: .7; font-size: 12px; margin-bottom: 6px; }
        .price { color: var(--primary); font-weight: 800; margin-bottom: 10px; }
        .buy {
          width: 100%;
          background: #1a2640;
          color: #d5e8ff;
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px;
          padding: 12px;
          cursor: pointer;
          font-weight: 700;
          text-align: center;
          text-decoration: none;
          display: inline-block;
        }
        .buy:hover { filter: brightness(1.08); }
        .footer { text-align: center; font-size: 12px; opacity: .7; margin: 28px 0 60px; }
      `}</style>

      <div className="wrap">
        <div className="hero">
          <div className="brand">
            {logoUrl ? <img src={logoUrl} alt={`${client.name || store} logo`} /> : null}
            <div>
              <h1>{client.name || store}</h1>
              <div style={{opacity:.8, fontSize:13}}>
                Curated catalog. Secure Stripe checkout.
              </div>
            </div>
          </div>
        </div>

        <div className="grid">
          {products.map(p => {
            const img = p.image ? withBase(basePath, p.image) : "";
            const link = p.link || "#";
            return (
              <div className="card" key={p.sku}>
                <div className="thumb">
                  {img ? <img src={img} alt={p.name} /> : <span>No image</span>}
                </div>
                <div className="card-body">
                  <div className="card-title">{p.name}</div>
                  <div className="sku">{p.sku}</div>
                  <div className="price">${Number(p.price).toFixed(2)}</div>
                  <a className="buy" href={link} target="_blank" rel="noreferrer">Buy</a>
                </div>
              </div>
            );
          })}
        </div>

        <div className="footer">
          © {new Date().getFullYear()} — {client.name || store}
        </div>
      </div>
    </>
  );
}

// Build-time: list store slugs by looking at /public/data/*.json (excluding products.json)
export async function getStaticPaths() {
  const dataDir = path.join(process.cwd(), "public", "data");
  const files = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  const slugs = files
    .filter(f => f.endsWith(".json") && f !== "products.json")
    .map(f => f.replace(/\.json$/,""));

  const paths = slugs.map((store) => ({ params: { store } }));
  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const basePath = "/cys_storefront_kit"; // matches next.config.js
  const store = params.store;

  // local files bundled with the site
  const client = readJSON(path.join("data", `${store}.json`));          // public/data/<store>.json
  const allProducts = readJSON(path.join("data", "products.json"));     // public/data/products.json

  const products = filterProducts(allProducts, client);

  return {
    props: { store, client, products, basePath }
  };
}