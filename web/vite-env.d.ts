/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // ws:// or wss:// base of the Go backend. Defaults to the page's host in dev.
  readonly VITE_BACKEND_WS?: string;
  // http(s):// base of the Go backend for REST (POST /rides, etc.).
  readonly VITE_BACKEND_HTTP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
