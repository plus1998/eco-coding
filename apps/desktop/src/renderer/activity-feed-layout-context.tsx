import { createContext, useContext } from "react";

export const ActivityFeedLayoutContext = createContext<(() => void) | undefined>(undefined);

export function useActivityFeedLayoutChange(): (() => void) | undefined {
  return useContext(ActivityFeedLayoutContext);
}
