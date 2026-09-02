import type { ReactNode } from "react";

interface ComposerDockMorphProps {
  showApproval: boolean;
  surfaceKey?: string;
  composer: ReactNode;
  approval: ReactNode;
}

export function ComposerDockMorph({ showApproval, surfaceKey, composer, approval }: ComposerDockMorphProps) {
  return (
    <div
      className={["composer-dock-morph", showApproval ? "is-approval" : "is-composer"]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="composer-dock-morph-surface"
        key={showApproval ? (surfaceKey ?? "approval") : "composer"}
        aria-live="polite"
      >
        {showApproval ? approval : composer}
      </div>
    </div>
  );
}
