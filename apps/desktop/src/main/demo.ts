import { app, BrowserWindow, Menu, nativeImage, nativeTheme, screen } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerDemoIpcHandlers } from "../demo/register-ipc-handlers";
import { resolveInitialWindowBounds } from "./desktop-window-placement";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const packagingDir = path.join(__dirname, "../../packaging");

function loadAppIcon(): Electron.NativeImage | undefined {
  const candidates =
    process.platform === "win32"
      ? ["icon.ico", "icon.png"]
      : process.platform === "darwin"
        ? ["icon.icns", "icon.png"]
        : ["icon.png", "icon.ico"];
  for (const name of candidates) {
    const iconPath = path.join(packagingDir, name);
    if (!existsSync(iconPath)) {
      continue;
    }
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }
  return undefined;
}

const appIcon = loadAppIcon();

app.setName("Eco Coding Demo");
app.setPath("userData", path.join(app.getPath("appData"), "Eco Coding Demo"));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  console.error("[eco-demo] another demo instance is already running; quitting.");
  app.quit();
}

function centerOnFocusedDisplay(window: BrowserWindow, width: number, height: number): void {
  window.setBounds(resolveInitialWindowBounds(width, height));
}

function showDemoWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  const bounds = window.getBounds();
  const displays = screen.getAllDisplays();
  const onVisibleDisplay = displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
  });
  if (!onVisibleDisplay) {
    centerOnFocusedDisplay(window, bounds.width, bounds.height);
  }
  window.show();
  window.focus();
  console.error("[eco-demo] window bounds", window.getBounds());
}

async function createDemoWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === "darwin";
  const width = 1600;
  const height = 960;
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    // Match production: show immediately. Demo must not wait on ready-to-show after
    // await loadURL — that event already fired and the window would stay invisible.
    show: true,
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          transparent: true,
          backgroundColor: "#00000000",
          vibrancy: "under-window" as const,
          visualEffectState: "followWindow" as const,
        }
      : {
          backgroundColor: "#212121",
          autoHideMenuBar: true,
        }),
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  centerOnFocusedDisplay(window, width, height);
  window.setTitle("Eco Coding Demo");

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[eco-demo] renderer failed to load", { errorCode, errorDescription, validatedURL });
    showDemoWindow(window);
  });

  window.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle("Eco Coding Demo");
  });

  window.webContents.on("before-input-event", (event, input) => {
    if ((input.meta || input.control) && input.key.toLowerCase() === "r") {
      event.preventDefault();
    }
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL as string;
    console.error(`[eco-demo] loading renderer ${url}`);
    await window.loadURL(url);
  } else {
    const htmlPath = path.join(__dirname, "../renderer/index.html");
    console.error(`[eco-demo] loading renderer file ${htmlPath}`);
    await window.loadFile(htmlPath);
  }

  showDemoWindow(window);
  return window;
}

app.on("second-instance", () => {
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) {
    showDemoWindow(existing);
  }
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  if (appIcon && process.platform === "darwin") {
    app.dock?.setIcon(appIcon);
    app.dock?.show();
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  registerDemoIpcHandlers({
    onRendererReady: (webContents) => {
      const window = BrowserWindow.fromWebContents(webContents);
      if (window) {
        showDemoWindow(window);
      }
    },
  });
  nativeTheme.themeSource = "dark";

  console.error("[eco-demo] creating window");
  await createDemoWindow();
  console.error("[eco-demo] window ready");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createDemoWindow();
    return;
  }
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing) {
    showDemoWindow(existing);
  }
});
