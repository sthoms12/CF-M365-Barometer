import { Activity, Gauge, RefreshCw } from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/AdminPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductPage } from "./pages/ProductPage";
import { ProductsPage } from "./pages/ProductsPage";

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

export function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/:slug" element={<ProductPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </>
  );
}
