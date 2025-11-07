import { listStores, readClient, readProducts } from "../utils/fsListStores";
import ProductCard from "../components/ProductCard";
import HeroBanner from "../components/HeroBanner";
import Head from "next/head";
import { useMemo, useState, useEffect } from "react";

export default function Storefront({ client, products }) {
  useEffect(() => {
    const b = client?.brand || {};
    const r = document.documentElement;
    if (b.bg1) r.style.setProperty("--bg1", b.bg1);
    if (b.bg2) r.style.setProperty("--bg2", b.bg2);
    if (b.text) r.style.setProperty("--text", b.text);
    if (b.primary) r.style.setProperty("--primary", b.primary);
  }, [client]);

  const [tag, setTag] = useState("All");
  const [sort, setSort] = useState("az");

  const tags = useMemo(() => {
    const t = new Set();
    products.forEach((p) => (p.tags || []).forEach((x) => t.add(x)));
    return ["All", ...Array.from(t)];
  }, [products]);

  const filtered = useMemo(() => {
    let rows = [...products];
    if (tag !== "All") rows = rows.filter((p) => (p.tags || []).includes(tag));
    if (sort === "az") rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "za") rows.sort((a, b) => b.name.localeCompare(a.name));
    if (sort === "price+") rows.sort((a, b) => Number(a.price) - Number(b.price));
    if (sort === "price-") rows.sort((a, b) => Number(b.price) - Number(a.price));
    return rows;
  }, [products, tag, sort]);

  return (
    <>
      <Head>
        <title>{client.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <HeroBanner client={client} />

      <div className="wrap">
        <header className="site-header">
          {client.brand?.logo ? (
            <img src={client.brand.logo} alt="Brand logo" />
          ) : null}
          <span className="site-title">{client.name}</span>
          <div style={{ opacity: .7, marginTop: 6 }}>Official merch · quick checkout via Stripe</div>
        </header>

        <div className="filters">
          <div className="chips">
            {tags.map((t) => (
              <div
                key={t}
                className={`chip ${t === tag ? "active" : ""}`}
                onClick={() => setTag(t)}
              >
                {t}
              </div>
            ))}
          </div>

          <div>
            <select className="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="az">A–Z</option>
              <option value="za">Z–A</option>
              <option value="price+">Price ↑</option>
              <option value="price-">Price ↓</option>
            </select>
          </div>
        </div>

        <div className="grid">
          {filtered.map((p) => <ProductCard key={`${p.sku}-${p.name}`} product={p} />)}
        </div>

        <div className="footer">
          © {new Date().getFullYear()} {client.name} — Powered by Notion & Stripe
        </div>
      </div>
    </>
  );
}

export async function getStaticPaths() {
  const stores = listStores();
  return {
    paths: stores.map((s) => ({ params: { store: s } })),
    fallback: false
  };
}

export async function getStaticProps({ params }) {
  const client = readClient(params.store);
  const all = readProducts();

  const allow = new Set([...(client.sku_allowlist || [])]);
  const prefixes = client.sku_prefixes || [];
  const match = (sku = "") => allow.has(sku) || prefixes.some((p) => sku.startsWith(p));

  const products = all
    .filter((p) => p.active && match(p.sku))
    .map((p) => ({
      name: p.name,
      sku: p.sku,
      price: p.price,
      link: p.link || null,
      image: p.image || null,
      tags: p.tags || []
    }));

  return { props: { client, products } };
}