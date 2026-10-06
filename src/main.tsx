import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Disable the browser context menu outside text fields so the app feels native.
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea, .selectable")) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
