import { useEffect, useState } from "react";
import type { ProductSummary } from "../../shared/contracts";
import { api } from "../api";
import { ProductCard } from "../components";

export function ProductsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  useEffect(() => { api<{ products: ProductSummary[] }>("/api/products").then((data) => setProducts(data.products)); }, []);
  return (
    <main className="page-shell">
      <div className="page-title">
        <p className="eyebrow">Tracked portfolio</p>
        <h1>Microsoft 365 Products</h1>
        <p>Every active product receives an automated Last30Days reading once per week.</p>
      </div>
      <div className="product-grid wide">
        {products.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>
    </main>
  );
}
