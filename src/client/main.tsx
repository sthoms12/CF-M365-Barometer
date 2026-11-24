import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App, preloadCurrentRoute } from "./App";
import { readHomeBootstrap, readProductBootstrap, readProductsBootstrap } from "./bootstrap";
import "./styles.css";

readHomeBootstrap();
readProductsBootstrap();
readProductBootstrap();

function mount() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

const routeReady = preloadCurrentRoute();
const path = window.location.pathname.replace(/\/+$/, "") || "/";
// /methodology, /about, /privacy, and /terms are server-rendered documents. Leave that HTML in #root.
const SERVER_DOCS = new Set(["/methodology", "/about", "/privacy", "/terms"]);
if (!SERVER_DOCS.has(path)) {
  if (path === "/") mount();
  else void routeReady.then(mount);
}
