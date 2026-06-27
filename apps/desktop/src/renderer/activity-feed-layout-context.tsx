import { createContext, useContext } from "react";

export type ActivityFeedLayoutChangeOptions = {
  /** Scroll/clamp immediately — use when feed content shrinks (e.g. thinking collapse). */
  immediate?: boolean;
};

export type ActivityFeedLayoutChange = (options?: ActivityFeedLayoutChangeOptions) => void;

export const ActivityFeedLayoutContext = createContext<ActivityFeedLayoutChange | undefined>(undefined);

export function useActivityFeedLayoutChange(): ActivityFeedLayoutChange | undefined {
  return useContext(ActivityFeedLayoutContext);
}
