import type { ProductSummary } from "../shared/contracts";
import type { HomeSections } from "../shared/home";

type HomeResponse = { sections: HomeSections };

export type ProductBootstrap = {
  product: ProductSummary;
  mentions: Array<Record<string, unknown>>;
  history: Array<{ analyzedAt: string; barometerScore: number }>;
};

function readJson<T>(id: string): T | null {
  if (typeof document === "undefined") return null;
  const node = document.getElementById(id);
  if (!node?.textContent) return null;
  try {
    return JSON.parse(node.textContent) as T;
  } catch {
    return null;
  }
}

let homeCache: HomeResponse | null | undefined;
let productsCache: ProductSummary[] | null | undefined;
let productCache: ProductBootstrap | null | undefined;

export function readHomeBootstrap(): HomeResponse | null {
  if (homeCache !== undefined) return homeCache;
  homeCache = readJson<HomeResponse>("home-bootstrap");
  return homeCache;
}

export function readProductsBootstrap(): ProductSummary[] | null {
  if (productsCache !== undefined) return productsCache;
  productsCache = readJson<ProductSummary[]>("products-bootstrap");
  return productsCache;
}

export function readProductBootstrap(): ProductBootstrap | null {
  if (productCache !== undefined) return productCache;
  productCache = readJson<ProductBootstrap>("product-bootstrap");
  return productCache;
}
