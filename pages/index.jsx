import Link from "next/link";
import { listStores, readClient } from "../utils/fsListStores";

export default function Home({ stores }) {
  return (
    <div className="wrap">
      <div className="site-header"><span className="site-title">Storefronts</span></div>
      <ul>
        {stores.map((s) => (
          <li key={s} style={{ margin: "10px 0" }}>
            <Link href={`/${s}/`}>{readable(s)}</Link>
          </li>
        ))}
      </ul>
      <div className="footer">© {new Date().getFullYear()} — Powered by Notion & Stripe</div>
    </div>
  );
}
const readable = (s) => s.replace(/[-_]/g, " ").replace(/\b\w/g, m => m.toUpperCase());
export async function getStaticProps() {
  const stores = listStores();
  stores.forEach((s) => readClient(s));
  return { props: { stores } };
}
