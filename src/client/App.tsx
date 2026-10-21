import { lazy, Suspense } from "react";
import { Activity, Gauge, RefreshCw } from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";

const loadProductsPage = () => import("./pages/ProductsPage");
const loadProductPage = () => import("./pages/ProductPage");
const ProductsPage = lazy(() => loadProductsPage().then((module) => ({ default: module.ProductsPage })));
const ProductPage = lazy(() => loadProductPage().then((module) => ({ default: module.ProductPage })));

let readyProducts: typeof import("./pages/ProductsPage") | null = null;
let readyProduct: typeof import("./pages/ProductPage") | null = null;

export function preloadCurrentRoute(): Promise<void> {
  const path = window.location.pathname;
  if (path === "/products") return loadProductsPage().then((module) => { readyProducts = module; });
  if (/^\/products\/[^/]+\/?$/.test(path)) return loadProductPage().then((module) => { readyProduct = module; });
  return Promise.resolve();
}

function CurrentProductsPage() {
  if (!readyProducts) return <ProductsPage />;
  const Page = readyProducts.ProductsPage;
  return <Page />;
}

function CurrentProductPage() {
  if (!readyProduct) return <ProductPage />;
  const Page = readyProduct.ProductPage;
  return <Page />;
}

function Header() {
  return (
    <header className="site-header">
      <NavLink to="/" className="brand">
        <span className="brand-mark"><Gauge size={20} /></span>
        <span>M365 Barometer</span>
      </NavLink>
      <nav aria-label="Primary navigation">
        <NavLink to="/" end><Activity size={16} /> Dashboard</NavLink>
        <NavLink to="/products"><RefreshCw size={16} /> Products</NavLink>
      </nav>
    </header>
  );
}

function RouteFallback() {
  return <main className="page-shell" aria-busy="true" />;
}

export function App() {
  return (
    <>
      <Header />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<CurrentProductsPage />} />
          <Route path="/products/:slug" element={<CurrentProductPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
