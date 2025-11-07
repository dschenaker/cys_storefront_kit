import fs from "fs";
import path from "path";
export function listStores() {
  const base = path.join(process.cwd(), "public", "stores");
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((n) => fs.existsSync(path.join(base, n, "client.json")));
}
export function readClient(store) {
  const p = path.join(process.cwd(), "public", "stores", store, "client.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
export function readProducts() {
  const p = path.join(process.cwd(), "data", "products.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
