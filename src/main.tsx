import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App as JoinWitnessApp } from "./ui/App.js";

export const APP_TITLE = "P008 倍行镜 JoinWitness";
export const APP_SUBTITLE = "LEFT JOIN 键倍增归因与反例生成器";
export const App = JoinWitnessApp;

const rootEl = typeof document !== "undefined" ? document.getElementById("root") : null;
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
