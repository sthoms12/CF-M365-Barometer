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
if (window.location.pathname === "/") mount();
else void routeReady.then(mount);
