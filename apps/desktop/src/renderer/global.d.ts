/// <reference types="vite/client" />

import type { EcoDesktopApi } from "../preload";

declare global {
  interface Window {
    eco?: EcoDesktopApi;
    /** DEV-only cursors for proving V2 renderer recovery convergence in CDP smoke tests. */
    __ecoConversationV2RendererSnapshot?: () => Record<
      string,
      {
        storeEpoch: string;
        appliedSeq: number;
        historyRevision: number;
        messageCount: number;
        runCount: number;
        toolCount: number;
        bufferedEffectSeqs: number[];
        loading: boolean;
        recoveryRequested: boolean;
        recoveryInFlight: boolean;
      }
    >;
  }
}
