import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// Point the API client at the backend — override with VITE_API_URL in production
const apiBase = import.meta.env.VITE_API_URL ?? "";
setBaseUrl(apiBase);

createRoot(document.getElementById("root")!).render(<App />);
