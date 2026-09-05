import { motion, useReducedMotion } from "framer-motion";
import { LoaderCircle, Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImageGalleryQueueItem } from "./image-gallery-float-state";
import { ImageLightbox } from "./image-lightbox";

/** 竖直画廊最多同时展示的层数：当前一张 + 下方两张排队预览。 */
const GALLERY_LAYER_COUNT = 3;

/** 单张图片加载后的数据：src 用于卡片与弹窗预览，fileName 用于展示图片标题。 */
interface LoadedImage {
  src: string;
  fileName?: string;
  /** 本地文件路径（有则可打开所在文件夹）。 */
  path?: string;
}

function galleryLayerTransform(layer: number): {
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
} {
  switch (layer) {
    case 0:
      return { y: 0, scale: 1, opacity: 1, zIndex: 30 };
    case 1:
      return { y: 44, scale: 0.965, opacity: 0.55, zIndex: 20 };
    default:
      return { y: 76, scale: 0.93, opacity: 0.28, zIndex: 10 };
  }
}

function GalleryCard({
  item,
  layer,
  onLoaded,
  onPreview,
  onAdvance,
}: {
  item: ImageGalleryQueueItem;
  layer: number;
  onLoaded: (item: ImageGalleryQueueItem, image: LoadedImage) => void;
  onPreview: (item: ImageGalleryQueueItem) => void;
  onAdvance: (item: ImageGalleryQueueItem) => void;
}) {
  const { t } = useTranslation();
  const isCurrent = layer === 0;
  const [src, setSrc] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    setFileName(undefined);
    setError(undefined);
    const bridge = window.eco;
    if (!bridge) {
      setError(t("imageGallery.loadError"));
      return;
    }
    void (async () => {
      if (item.kind === "display") {
        const result = await bridge.readImageDisplay({ artifactId: item.artifactId });
        if (!result.ok) {
          const codeKey =
            result.code === "not_found"
              ? "notFound"
              : result.code === "too_large"
                ? "tooLarge"
                : result.code === "unsupported_type"
                  ? "unsupportedType"
                  : "readFailed";
          throw new Error(t(`activity.imageDisplay.error.${codeKey}`));
        }
        if (cancelled) return;
        const url = `data:${result.mimeType};base64,${result.dataBase64}`;
        setFileName(result.fileName);
        setSrc(url);
        onLoaded(item, { src: url, fileName: result.fileName, path: result.path });
        return;
      }
      const result = await bridge.readImageGenerationArtifact({
        artifactId: item.artifactId,
        imageIndex: item.imageIndex ?? 0,
      });
      if (cancelled) return;
      const url = `data:${result.mimeType};base64,${result.dataBase64}`;
      setSrc(url);
      onLoaded(item, { src: url, path: result.path });
    })().catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [item, t, onLoaded]);

  const alt =
    item.kind === "display"
      ? t("activity.imageDisplay.previewAlt", { name: fileName ?? t("task.imageDisplay.emptyTitle") })
      : t("task.image.title");
  const transform = galleryLayerTransform(layer);
  const showOverlays = isCurrent && !error;

  return (
    <motion.div
      className={isCurrent ? "image-gallery-card image-gallery-card--current" : "image-gallery-card"}
      aria-hidden={!isCurrent}
      initial={false}
      animate={{
        y: transform.y,
        scale: transform.scale,
        opacity: transform.opacity,
        zIndex: transform.zIndex,
      }}
      transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
      style={{ pointerEvents: isCurrent ? "auto" : "none" }}
    >
      <div className="image-gallery-card-frame">
        {src ? (
          <button
            type="button"
            className="image-gallery-card-media"
            onClick={() => onPreview(item)}
            aria-label={t("imageGallery.preview")}
            title={t("imageGallery.preview")}
          >
            <img src={src} alt={alt} draggable={false} />
          </button>
        ) : error ? (
          <div className="image-gallery-card-media image-gallery-card-media--error" role="alert">
            {error}
          </div>
        ) : (
          <div className="image-gallery-card-media image-gallery-card-media--loading">
            <LoaderCircle className="image-gallery-card-spinner" size={22} aria-hidden />
            <span>{t("imageGallery.loading")}</span>
          </div>
        )}
        {showOverlays ? (
          <>
            <button
              type="button"
              className="image-gallery-card-overlay image-gallery-card-overlay--preview"
              onClick={src ? () => onPreview(item) : undefined}
              aria-label={t("imageGallery.preview")}
            >
              <Maximize2 size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="image-gallery-card-overlay image-gallery-card-overlay--close"
              onClick={() => onAdvance(item)}
              aria-label={t("imageGallery.closeCurrent")}
            >
              <X size={16} aria-hidden />
            </button>
          </>
        ) : null}
      </div>
    </motion.div>
  );
}

/**
 * 图片画廊悬浮窗：停靠在右侧，竖直方向排队展示展示图片 / 创意绘画工具产出的图片。
 * 纯图片无边框；hover 当前图片时右上角显示关闭图标、居中显示预览图标，点击预览图标直接打开弹窗预览。
 * 关闭当前一张即切换到下一张；队列清空或按 Esc 整体关闭后回到 workspace cards。
 */
export function ImageGalleryFloat({
  items,
  onAdvance,
  onCloseAll,
  avoidCards = false,
}: {
  items: readonly ImageGalleryQueueItem[];
  onAdvance: (item: ImageGalleryQueueItem) => void;
  onCloseAll: () => void;
  avoidCards?: boolean;
}) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [loadedImages, setLoadedImages] = useState<Record<string, LoadedImage>>({});
  const [previewItem, setPreviewItem] = useState<ImageGalleryQueueItem | null>(null);

  const closeCurrent = useCallback((item: ImageGalleryQueueItem) => onAdvance(item), [onAdvance]);
  const handleLoaded = useCallback((item: ImageGalleryQueueItem, image: LoadedImage) => {
    setLoadedImages((prev) => (prev[item.key] ? prev : { ...prev, [item.key]: image }));
  }, []);
  const handlePreview = useCallback((item: ImageGalleryQueueItem) => {
    setPreviewItem(item);
  }, []);
  const closePreview = useCallback(() => setPreviewItem(null), []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // 弹窗预览打开时由 ImageLightbox 处理 Esc（只关预览，不关整个画廊）。
      if (event.key === "Escape" && !previewItem) {
        onCloseAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCloseAll, previewItem]);

  const previewLoaded = previewItem ? loadedImages[previewItem.key] : undefined;
  const previewTitle = previewItem
    ? previewItem.kind === "display"
      ? (previewLoaded?.fileName ?? t("task.imageDisplay.emptyTitle"))
      : t("task.image.title")
    : "";
  const previewAlt = previewItem
    ? previewItem.kind === "display"
      ? t("activity.imageDisplay.previewAlt", { name: previewTitle })
      : t("task.image.title")
    : "";

  const revealPreviewFolder = useCallback(() => {
    const path = previewLoaded?.path;
    if (!path) return;
    const bridge = window.eco;
    if (!bridge?.revealImageInFolder) return;
    void bridge.revealImageInFolder({ path }).catch((error) => {
      console.warn("Failed to open the folder containing the image.", error);
    });
  }, [previewLoaded]);

  return (
    <motion.div
      className={avoidCards ? "image-gallery-float image-gallery-float--avoid-cards" : "image-gallery-float"}
      role="region"
      aria-label={t("imageGallery.title")}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.9 }}
    >
      <div className="image-gallery-float-stack" aria-live="polite">
        {items.slice(0, GALLERY_LAYER_COUNT).map((item, layer) => (
          <GalleryCard
            key={item.key}
            item={item}
            layer={layer}
            onLoaded={handleLoaded}
            onPreview={handlePreview}
            onAdvance={closeCurrent}
          />
        ))}
      </div>
      {previewItem && previewLoaded ? (
        <ImageLightbox
          src={previewLoaded.src}
          alt={previewAlt}
          title={previewTitle}
          dialogLabel={t("imageGallery.preview")}
          {...(previewLoaded.path ? { onOpenFolder: revealPreviewFolder } : {})}
          onClose={closePreview}
        />
      ) : null}
    </motion.div>
  );
}
