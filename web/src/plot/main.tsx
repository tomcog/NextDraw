import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// index.css first: it declares the cascade layer order, so the library's `@layer ui`
// sits below the app's own styles regardless of import order.
import "../index.css";
// The component library ships its CSS as a separate file; it must be imported once.
import "@tomcoggia/ui/styles.css";
import "@tomcoggia/ui/fonts.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
