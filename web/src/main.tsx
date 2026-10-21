import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import "./index.css";

// 2026-10-21: the localStorage keys moved from "ss." to "sst." (Simple Silver Tongue). Carry a browser's remembered
// panels, tabs and last username over once, so the rename changes nothing anyone sees.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("ss.")) continue;
    const next = `sst.${key.slice(3)}`;
    const value = localStorage.getItem(key);
    if (localStorage.getItem(next) === null && value !== null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
  }
} catch {
  // storage blocked: nothing to carry over
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
