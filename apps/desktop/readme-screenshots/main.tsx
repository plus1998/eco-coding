import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../src/renderer/i18n";
import "../src/renderer/themes.css";
import "../src/renderer/styles.css";
import "./demo.css";
import { ReadmeDemoSceneView, resolveReadmeDemoScene } from "./scenes";

async function boot() {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.platform = "darwin";
  document.documentElement.dataset.appReady = "true";
  document.documentElement.lang = "zh-CN";

  await i18n.changeLanguage("zh-CN");

  const scene = resolveReadmeDemoScene(new URLSearchParams(window.location.search).get("scene"));
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Missing #root");
  }

  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <ReadmeDemoSceneView scene={scene} />
      </I18nextProvider>
    </StrictMode>,
  );

  root.dataset.readmeDemoReady = "true";
  root.dataset.readmeDemoScene = scene;
}

void boot();
