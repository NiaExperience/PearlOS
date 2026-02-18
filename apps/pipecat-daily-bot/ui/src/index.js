import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

// Import room URL from config (which reads from environment variables)
export { roomUrl } from "./config";

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
