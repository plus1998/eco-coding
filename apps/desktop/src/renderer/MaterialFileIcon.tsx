import { useSyncExternalStore, type CSSProperties } from "react";
import { resolveMaterialIconName, getMaterialIconUrl } from "./material-file-icon";

function subscribeTheme(onStoreChange: () => void): () => void {
  const root = document.documentElement;
  const observer = new MutationObserver(onStoreChange);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readIsLightTheme(): boolean {
  return document.documentElement.dataset.theme === "light";
}

export interface MaterialFileIconProps {
  path: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function MaterialFileIcon({ path, size = 16, className, style }: MaterialFileIconProps) {
  const light = useSyncExternalStore(subscribeTheme, readIsLightTheme, () => false);
  const iconName = resolveMaterialIconName(path, { light });
  const url = getMaterialIconUrl(iconName);

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={className}
      style={{ width: size, height: size, flex: `0 0 ${size}px`, ...style }}
      aria-hidden
    />
  );
}
