/// <reference types="vite/client" />

import type { EcoDesktopApi } from "../preload";

declare global {
  interface Window {
    eco?: EcoDesktopApi;
  }
}
