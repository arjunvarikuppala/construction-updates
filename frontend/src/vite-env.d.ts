/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full URL of the Render backend, e.g. https://sitetrack-api.onrender.com
   *  Leave unset in development — Vite proxy handles routing transparently. */
  readonly VITE_API_URL?: string;
  /** WebSocket origin override — defaults to VITE_API_URL when not set. */
  readonly VITE_SOCKET_URL?: string;
  /** Contact email shown on the Privacy Policy and Delete Account pages (Google Play needs one). */
  readonly VITE_SUPPORT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
