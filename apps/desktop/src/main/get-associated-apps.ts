import { execFile } from "node:child_process";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AssociatedApp {
  name: string;
  bundleId: string;
  iconBase64?: string | undefined;
  isDefault?: boolean;
}

const ICON_SIZE = 32;
const MAX_APPS = 8;

/**
 * Get associated applications for a file path based on its extension/type.
 */
export async function getAssociatedApps(filePath: string): Promise<AssociatedApp[]> {
  const platform = process.platform;
  console.log(`[AssociatedApps] Platform: ${platform}, File: ${filePath}`);
  try {
    if (platform === "darwin") return await getAssociatedAppsMacOS(filePath);
    if (platform === "win32") return await getAssociatedAppsWindows(filePath);
    return await getAssociatedAppsLinux(filePath);
  } catch (error) {
    console.error("[AssociatedApps] Error:", error);
    return [];
  }
}

// ─── macOS ───────────────────────────────────────────────────────────────────

interface MacOSCommonApp {
  name: string;
  bundleId: string;
}

const MACOS_COMMON_APPS: MacOSCommonApp[] = [
  { name: "Visual Studio Code", bundleId: "com.microsoft.VSCode" },
  { name: "VS Code Insiders", bundleId: "com.microsoft.VSCodeInsiders" },
  { name: "Cursor", bundleId: "com.todesktop.230313mzl4w4u92" },
  { name: "Sublime Text", bundleId: "com.sublimetext.4" },
  { name: "Sublime Text 3", bundleId: "com.sublimetext.3" },
  { name: "TextEdit", bundleId: "com.apple.TextEdit" },
  { name: "Xcode", bundleId: "com.apple.dt.Xcode" },
  { name: "BBEdit", bundleId: "com.barebones.bbedit" },
  { name: "CotEditor", bundleId: "com.coteditor.CotEditor" },
  { name: "Typora", bundleId: "abnerworks.Typora" },
  { name: "MacVim", bundleId: "org.vim.MacVim" },
  { name: "IntelliJ IDEA", bundleId: "com.jetbrains.intellij" },
  { name: "IntelliJ IDEA CE", bundleId: "com.jetbrains.intellij.ce" },
  { name: "WebStorm", bundleId: "com.jetbrains.WebStorm" },
  { name: "PyCharm", bundleId: "com.jetbrains.pycharm" },
  { name: "GoLand", bundleId: "com.jetbrains.goland" },
  { name: "CLion", bundleId: "com.jetbrains.clion" },
  { name: "PhpStorm", bundleId: "com.jetbrains.PhpStorm" },
  { name: "DataGrip", bundleId: "com.jetbrains.datagrip" },
  { name: "Rider", bundleId: "com.jetbrains.rider" },
  { name: "RubyMine", bundleId: "com.jetbrains.RubyMine" },
  { name: "Android Studio", bundleId: "com.google.android.studio" },
  { name: "Zed", bundleId: "dev.zed.Zed" },
  { name: "Nova", bundleId: "com.panic.Nova" },
  { name: "Brackets", bundleId: "io.brackets.appshell" },
  { name: "Atom", bundleId: "com.github.atom" },
  { name: "Emacs", bundleId: "org.gnu.Emacs" },
];

async function getAssociatedAppsMacOS(filePath: string): Promise<AssociatedApp[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return [];

  try {
    const apps: AssociatedApp[] = [];
    const foundBundleIds = new Set<string>();

    for (const app of MACOS_COMMON_APPS) {
      if (foundBundleIds.has(app.bundleId)) continue;
      const appPath = await findMacOSAppByBundleId(app.bundleId);
      if (appPath) {
        foundBundleIds.add(app.bundleId);
        const iconBase64 = await getMacOSAppIcon(appPath);
        apps.push({ name: app.name, bundleId: app.bundleId, iconBase64 });
        if (apps.length >= MAX_APPS) break;
      }
    }

    return apps;
  } catch (error) {
    console.error("[macOS] getAssociatedApps error:", error);
    return [];
  }
}

async function findMacOSAppByBundleId(bundleId: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("mdfind", [
      `kMDItemCFBundleIdentifier == "${bundleId}"`,
    ]);
    const paths = stdout.split("\n").filter(Boolean);
    return paths[0] ?? null;
  } catch {
    return null;
  }
}

async function getMacOSAppIcon(appPath: string): Promise<string | undefined> {
  try {
    const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
    const exists = await fsPromises.access(infoPlistPath).then(() => true).catch(() => false);
    if (!exists) return undefined;

    // Get icon file name from Info.plist
    const { stdout: iconNameOutput } = await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleIconFile",
      infoPlistPath,
    ]).catch(() => ({ stdout: "" }));

    let iconFile = iconNameOutput.trim();
    if (!iconFile || iconFile === "Does Not Exist") {
      // Try common icon names
      iconFile = "AppIcon.icns";
    } else if (!iconFile.endsWith(".icns")) {
      iconFile += ".icns";
    }

    const iconPath = path.join(appPath, "Contents", "Resources", iconFile);
    const iconExists = await fsPromises.access(iconPath).then(() => true).catch(() => false);
    if (!iconExists) {
      // Try alternative icon names
      const altNames = ["AppIcon.icns", "icon.icns", "logo.icns"];
      for (const alt of altNames) {
        const altPath = path.join(appPath, "Contents", "Resources", alt);
        const altExists = await fsPromises.access(altPath).then(() => true).catch(() => false);
        if (altExists) {
          return convertIcnsToBase64(altPath);
        }
      }
      return undefined;
    }

    return convertIcnsToBase64(iconPath);
  } catch {
    return undefined;
  }
}

async function convertIcnsToBase64(icnsPath: string): Promise<string | undefined> {
  const tmpPath = path.join(os.tmpdir(), `eco_icon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
  try {
    await execFileAsync("sips", [
      "-s", "format", "png",
      "--resampleWidth", String(ICON_SIZE),
      icnsPath,
      "--out", tmpPath,
    ]);
    const data = await fsPromises.readFile(tmpPath);
    await fsPromises.unlink(tmpPath).catch(() => {});
    if (data.length > 0) {
      return `data:image/png;base64,${data.toString("base64")}`;
    }
  } catch {
    await fsPromises.unlink(tmpPath).catch(() => {});
  }
  return undefined;
}

// ─── Windows ─────────────────────────────────────────────────────────────────

async function getAssociatedAppsWindows(filePath: string): Promise<AssociatedApp[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return [];

  try {
    const progIds = await getWindowsOpenWithProgIds(ext);
    const apps: AssociatedApp[] = [];

    for (const progId of progIds.slice(0, MAX_APPS)) {
      const name = await getWindowsProgIdName(progId);
      const iconBase64 = await getWindowsProgIdIcon(progId);
      console.log(`[getAssociatedAppsWindows] ${progId} -> name=${name}, hasIcon=${!!iconBase64}`);
      apps.push({ name, bundleId: progId, iconBase64 });
    }

    // Move the default app (first in OpenWithProgIDs/OpenWithList) to the front
    // and mark it as default
    if (apps.length > 0) {
      apps[0] = { ...apps[0]!, isDefault: true };
    }

    console.log(`[getAssociatedAppsWindows] Returning ${apps.length} apps, default=${apps[0]?.bundleId}`);
    return apps;
  } catch (error) {
    console.error("[Windows] getAssociatedApps error:", error);
    return [];
  }
}

async function getWindowsOpenWithProgIds(ext: string): Promise<string[]> {
  const progIds: string[] = [];

  // Method 1: Query OpenWithProgIDs directly
  try {
    const { stdout } = await execFileAsync("reg", [
      "query", `HKCR\\${ext}\\OpenWithProgIDs`, "/s",
    ]);
    for (const line of stdout.split("\n")) {
      const match = line.match(/^\s*([a-zA-Z0-9_\-\.]+)\s+REG_SZ/);
      if (match?.[1]) {
        progIds.push(match[1]);
      }
    }
  } catch {
    // Key doesn't exist, continue
  }

  // Method 2: Query OpenWithList
  if (progIds.length === 0) {
    try {
      const { stdout } = await execFileAsync("reg", [
        "query", `HKCR\\${ext}\\OpenWithList`, "/s",
      ]);
      for (const line of stdout.split("\n")) {
        const match = line.match(/^\s*([a-zA-Z0-9]+)\s+REG_SZ/);
        if (match?.[1] && !progIds.includes(match[1])) {
          progIds.push(match[1]);
        }
      }
    } catch {
      // Key doesn't exist, continue
    }
  }

  // Method 3: Get the ProgID from the extension's default value, then check its shell\open\command
  if (progIds.length === 0) {
    try {
      const { stdout } = await execFileAsync("reg", [
        "query", `HKCR\\${ext}`, "/ve",
      ]);
      const match = stdout.match(/REG_SZ\s+(.+)$/m);
      if (match?.[1]) {
        const progId = match[1].trim();
        if (progId && progId !== ext) {
          progIds.push(progId);
        }
      }
    } catch {
      // Continue
    }
  }

  // Method 4: Check HKCR\Applications for common apps that handle this extension
  if (progIds.length === 0) {
    const commonApps = [
      { name: "Code", progId: "Code.exe" },
      { name: "notepad", progId: "notepad.exe" },
      { name: "Notepad++", progId: "notepad++.exe" },
    ];

    for (const app of commonApps) {
      try {
        await execFileAsync("where", [app.progId]);
        progIds.push(app.progId);
      } catch {
        // App not found
      }
    }
  }

  console.log(`[Windows] Found ${progIds.length} ProgIDs for ${ext}:`, progIds);
  return progIds;
}

async function getWindowsProgIdName(progId: string): Promise<string> {
  // First: try to get friendly name from registry (works for ProgIDs)
  try {
    const { stdout } = await execFileAsync("reg", [
      "query", `HKCR\\${progId}`, "/ve",
    ]);
    // Registry output format: "    (default)    REG_SZ    Value"
    // Use a more robust regex to extract the value after REG_SZ
    const regMatch = stdout.match(/REG_SZ\s+([^\r\n]+)/);
    if (regMatch?.[1]) {
      const name = regMatch[1].trim();
      if (name && name !== "") {
        console.log(`[getWindowsProgIdName] Found name for ${progId}:`, name);
        return name;
      }
    }
  } catch (error) {
    console.log(`[getWindowsProgIdName] reg query failed for ${progId}:`, error);
    // Fallback
  }

  // Second: try to get exe path from shell\open\command and resolve its name
  let exePathFromCommand: string | undefined;
  try {
    const { stdout } = await execFileAsync("reg", [
      "query", `HKCR\\${progId}\\shell\\open\\command`, "/ve",
    ]);
    const cmdMatch = stdout.match(/REG_SZ\s+"([^"]+)"/);
    if (cmdMatch?.[1]) {
      exePathFromCommand = cmdMatch[1];
      // Try to get friendly name from exe version info
      const exeName = path.basename(exePathFromCommand, path.extname(exePathFromCommand));
      const friendlyName = await getWindowsExeFileDescription(exeName + ".exe");
      if (friendlyName) return friendlyName;
      return exeName;
    }
  } catch {
    // Fallback
  }

  // Third: check ProgID to friendly name mapping
  const progIdLower = progId.toLowerCase();
  const progIdNames: Record<string, string> = {
    "txtfilelegacy": "记事本",
    "txtfile": "记事本",
    "powershellscript": "Windows PowerShell",
    "powershellscript.1": "Windows PowerShell",
    "microsoft.powershellscript.1": "Windows PowerShell",
    "cmdfile": "命令提示符",
    "batfile": "命令提示符",
    "regfile": "注册表编辑器",
    "inifile": "记事本",
    "textfile": "记事本",
    "chmfile": "HTML Help",
    "htmlfile": "浏览器",
    "svgfile": "浏览器",
    "xmlfile": "XML 编辑器",
    "wsffile": "Windows Script File",
    "ms-office:ppt": "PowerPoint",
    "ms-office:word": "Word",
    "ms-office:excel": "Excel",
    "ms-office:outlook": "Outlook",
    "vlc": "VLC",
    "vlc.mp4": "VLC",
    "vlc.avi": "VLC",
    "vlc.mkv": "VLC",
    "potplayer": "PotPlayer",
    "potplayer64": "PotPlayer",
    "kmplayer": "KMPlayer",
    "mp4file": "视频播放器",
    "avifile": "视频播放器",
    "mkvfile": "视频播放器",
    "mp3file": "音频播放器",
    "wavfile": "音频播放器",
    "flacfile": "音频播放器",
    "pngfile": "图片查看器",
    "jpgfile": "图片查看器",
    "jpegfile": "图片查看器",
    "bmpfile": "图片查看器",
    "giffile": "图片查看器",
    "pdf.adobe": "Adobe Acrobat",
    "acrobat": "Adobe Acrobat",
    "foxit": "Foxit Reader",
    "sumatrapdf": "SumatraPDF",
  };
  if (progIdNames[progIdLower]) return progIdNames[progIdLower];

  // Fourth: if progId is an executable name, use friendly name mapping
  const exeName = progIdLower.endsWith(".exe") ? progIdLower : progIdLower + ".exe";
  if (progIdLower.endsWith(".exe") || /^[a-z][a-z0-9]+$/.test(progId)) {
    const friendlyNames: Record<string, string> = {
      "code.exe": "Visual Studio Code",
      "code - insiders.exe": "VS Code Insiders",
      "code - oss.exe": "VS Code OSS",
      "cursor.exe": "Cursor",
      "sublime_text.exe": "Sublime Text",
      "subl.exe": "Sublime Text",
      "notepad++.exe": "Notepad++",
      "notepad.exe": "Notepad",
      "atom.exe": "Atom",
      "brackets.exe": "Brackets",
      "typora.exe": "Typora",
      "gvim.exe": "gVim",
      "vim.exe": "Vim",
      "neovide.exe": "Neovide",
      "nvim-qt.exe": "Neovim",
      "nvim.exe": "Neovim",
      "godot.exe": "Godot",
      "unity.exe": "Unity",
      "rider64.exe": "Rider",
      "webstorm64.exe": "WebStorm",
      "pycharm64.exe": "PyCharm",
      "goland64.exe": "GoLand",
      "clion64.exe": "CLion",
      "phpstorm64.exe": "PhpStorm",
      "datagrip64.exe": "DataGrip",
      "rubymine64.exe": "RubyMine",
      "appcode64.exe": "AppCode",
      "idea64.exe": "IntelliJ IDEA",
      "androidstudio64.exe": "Android Studio",
      "blender.exe": "Blender",
      "gimp-2.10.exe": "GIMP",
      "inkscape.exe": "Inkscape",
      "krita.exe": "Krita",
      "paint.net.exe": "Paint.NET",
      "photoshop.exe": "Photoshop",
      "illustrator.exe": "Illustrator",
      "afterfx.exe": "After Effects",
      "premierepro.exe": "Premiere Pro",
      "audition.exe": "Audition",
      "figma.exe": "Figma",
      "sketchup.exe": "SketchUp",
      "obs64.exe": "OBS Studio",
      "streamlabs obs.exe": "Streamlabs OBS",
      "discord.exe": "Discord",
      "slack.exe": "Slack",
      "teams.exe": "Microsoft Teams",
      "zoom.exe": "Zoom",
      "webex.exe": "Webex",
      "firefox.exe": "Firefox",
      "chrome.exe": "Google Chrome",
      "msedge.exe": "Microsoft Edge",
      "brave.exe": "Brave",
      "opera.exe": "Opera",
      "vivaldi.exe": "Vivaldi",
      "7zFM.exe": "7-Zip",
      "winrar.exe": "WinRAR",
      "explorer.exe": "File Explorer",
      "devenv.exe": "Visual Studio",
      "python.exe": "Python",
      "node.exe": "Node.js",
      "iexplore.exe": "Internet Explorer",
      "quark.exe": "Quark",
      "360chrome.exe": "360 Chrome",
      "360se.exe": "360 Secure Browser",
      "sogou.exe": "Sogou Explorer",
      "ucbrowser.exe": "UC Browser",
      "qqbrowser.exe": "QQ Browser",
      "baidubrowser.exe": "Baidu Browser",
      "safari.exe": "Safari",
      "wordpad.exe": "WordPad",
      "mspaint.exe": "Paint",
      "calc.exe": "Calculator",
      "snippingtool.exe": "Snipping Tool",
      "mstsc.exe": "Remote Desktop",
      "taskmgr.exe": "Task Manager",
      "cmd.exe": "Command Prompt",
      "powershell.exe": "PowerShell",
      "pwsh.exe": "PowerShell",
      "wt.exe": "Windows Terminal",
      "terminal.exe": "Windows Terminal",
    };
    if (friendlyNames[exeName]) return friendlyNames[exeName];
    // Fallback: try to get FileDescription from executable version info
    const friendlyName = await getWindowsExeFileDescription(exeName);
    if (friendlyName) return friendlyName;
    return path.basename(progId, ".exe");
  }

  return progId;
}

async function getWindowsExeFileDescription(exeName: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("where", [exeName]);
    const exePath = stdout.split("\n")[0]?.trim();
    if (!exePath) return undefined;

    // Use PowerShell to get FileDescription from version info
    const psCommand = `(Get-ItemProperty -Path '${exePath.replace(/'/g, "''")}').VersionInfo.FileDescription`;
    const { stdout: descOutput } = await execFileAsync("powershell", [
      "-NoProfile", "-Command", psCommand,
    ]);
    const desc = descOutput.trim();
    if (desc && desc !== "" && !desc.includes("Get-ItemProperty")) {
      return desc;
    }
  } catch {
    // Ignore
  }
  return undefined;
}

async function getWindowsProgIdIcon(progId: string): Promise<string | undefined> {
  // If progId is an executable name, find its full path first
  let iconPath: string | undefined;

  if (progId.toLowerCase().endsWith(".exe")) {
    try {
      const { stdout } = await execFileAsync("where", [progId]);
      const exePath = stdout.split("\n")[0]?.trim();
      if (exePath) {
        iconPath = exePath;
        console.log(`[getWindowsProgIdIcon] Found exe path for ${progId}: ${iconPath}`);
      }
    } catch {
      // Not found
    }
  }

  // If not found yet, try registry DefaultIcon
  if (!iconPath) {
    try {
      const { stdout } = await execFileAsync("reg", [
        "query", `HKCR\\${progId}\\DefaultIcon`, "/ve",
      ]);
      // Registry value may or may not be quoted
      const iconMatch = stdout.match(/REG_SZ\s+"?([^,\r\n]+)"?/);
      if (iconMatch?.[1]) {
        iconPath = iconMatch[1].trim();
        // Remove index suffix like ",0"
        const commaIdx = iconPath.lastIndexOf(",");
        if (commaIdx > 0) {
          iconPath = iconPath.slice(0, commaIdx);
        }
        iconPath = iconPath.replace(/%([^%]+)%/g, (_, varName) => process.env[varName] || "");
        console.log(`[getWindowsProgIdIcon] Resolved icon path for ${progId}: ${iconPath}`);
      }
    } catch (error) {
      console.log(`[getWindowsProgIdIcon] DefaultIcon reg query failed for ${progId}:`, error);
      // Continue
    }
  }

  if (!iconPath) {
    console.log(`[getWindowsProgIdIcon] No icon path found for ${progId}`);
    return undefined;
  }

  const exists = await fsPromises.access(iconPath).then(() => true).catch(() => false);
  if (!exists) {
    console.log(`[getWindowsProgIdIcon] Icon path does not exist: ${iconPath}`);
    return undefined;
  }

  const tmpPath = path.join(os.tmpdir(), `eco_icon_${Date.now()}.png`);
  const psScript = `
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon("${iconPath.replace(/\\/g, "\\\\")}")
$bitmap = New-Object System.Drawing.Bitmap(${ICON_SIZE}, ${ICON_SIZE})
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.DrawImage($icon, 0, 0, ${ICON_SIZE}, ${ICON_SIZE})
$bitmap.Save("${tmpPath.replace(/\\/g, "\\\\")}", [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$icon.Dispose()
`;

  try {
    console.log(`[getWindowsProgIdIcon] Extracting icon from: ${iconPath}`);
    await execFileAsync("powershell", ["-NoProfile", "-Command", psScript]);

    const data = await fsPromises.readFile(tmpPath);
    await fsPromises.unlink(tmpPath).catch(() => {});

    console.log(`[getWindowsProgIdIcon] Icon extracted successfully for ${progId}, size: ${data.length} bytes`);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch (error) {
    console.log(`[getWindowsProgIdIcon] PowerShell icon extraction failed for ${progId}:`, error);
    await fsPromises.unlink(tmpPath).catch(() => {});
    return undefined;
  }
}

// ─── Linux ───────────────────────────────────────────────────────────────────

async function getAssociatedAppsLinux(filePath: string): Promise<AssociatedApp[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return [];

  try {
    const mimeType = await getLinuxMimeType(ext);
    if (!mimeType) return [];

    const desktopFiles = await getLinuxAppsForMimeType(mimeType);
    const apps: AssociatedApp[] = [];

    for (const desktopFile of desktopFiles.slice(0, MAX_APPS)) {
      const { name, iconName } = await parseLinuxDesktopFile(desktopFile);
      const iconBase64 = await getLinuxIcon(iconName);
      apps.push({ name, bundleId: desktopFile, iconBase64 });
    }

    return apps;
  } catch (error) {
    console.error("[Linux] getAssociatedApps error:", error);
    return [];
  }
}

async function getLinuxMimeType(ext: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("xdg-mime", ["query", "filetype", `/tmp/dummy${ext}`]);
    const mime = stdout.trim();
    if (mime && mime !== "application/octet-stream") return mime;
  } catch {
    // Fallback
  }

  try {
    const { stdout } = await execFileAsync("file", ["--mime-type", "-b", `/tmp/dummy${ext}`]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getLinuxAppsForMimeType(mimeType: string): Promise<string[]> {
  try {
    const { stdout: defaultApp } = await execFileAsync("xdg-mime", ["query", "default", mimeType]);
    const desktopFiles = defaultApp.split("\n").map((f) => f.trim()).filter(Boolean);

    const searchDirs = [
      "/usr/share/applications",
      "/usr/local/share/applications",
      path.join(os.homedir(), ".local/share/applications"),
    ];

    for (const dir of searchDirs) {
      try {
        const files = await fsPromises.readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".desktop")) continue;
          if (desktopFiles.includes(file)) continue;

          const filePath = path.join(dir, file);
          try {
            const content = await fsPromises.readFile(filePath, "utf-8");
            const mimeLine = content.split("\n").find((l) => l.startsWith("MimeType="));
            if (mimeLine) {
              const mimeTypes = mimeLine.split("=")[1]?.split(";").map((m) => m.trim()) || [];
              if (mimeTypes.includes(mimeType) || mimeTypes.some((m) => mimeType.startsWith(m.replace("/*", "/")))) {
                desktopFiles.push(file);
              }
            }
          } catch {
            // Skip
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return desktopFiles;
  } catch {
    return [];
  }
}

async function parseLinuxDesktopFile(desktopFileName: string): Promise<{ name: string; iconName: string }> {
  const searchDirs = [
    path.join(os.homedir(), ".local/share/applications"),
    "/usr/local/share/applications",
    "/usr/share/applications",
  ];

  for (const dir of searchDirs) {
    const filePath = path.join(dir, desktopFileName);
    try {
      const exists = await fsPromises.access(filePath).then(() => true).catch(() => false);
      if (!exists) continue;

      const content = await fsPromises.readFile(filePath, "utf-8");
      let name = "";
      let iconName = "";

      for (const line of content.split("\n")) {
        if (line.startsWith("Name=") && !name) {
          name = line.split("=").slice(1).join("=").trim();
        } else if (line.startsWith("Icon=")) {
          iconName = line.split("=").slice(1).join("=").trim();
        }
      }

      if (name) return { name, iconName };
    } catch {
      // Continue
    }
  }

  return { name: desktopFileName.replace(".desktop", ""), iconName: "" };
}

async function getLinuxIcon(iconName: string): Promise<string | undefined> {
  if (!iconName) return undefined;

  try {
    if (iconName.startsWith("/")) {
      const exists = await fsPromises.access(iconName).then(() => true).catch(() => false);
      if (exists) {
        const data = await fsPromises.readFile(iconName);
        const ext = path.extname(iconName).toLowerCase();
        const mime = ext === ".svg" ? "image/svg+xml" : "image/png";
        return `data:${mime};base64,${data.toString("base64")}`;
      }
    }

    const iconDirs = [
      path.join(os.homedir(), ".icons"),
      "/usr/share/icons",
      "/usr/share/pixmaps",
    ];

    const sizes = ["48x48", "32x32", "24x24", "22x22", "16x16", "scalable"];
    const themes = ["hicolor", "Adwaita", "gnome", "elementary"];

    for (const iconDir of iconDirs) {
      for (const theme of themes) {
        for (const size of sizes) {
          const candidates = [
            path.join(iconDir, theme, size, "apps", `${iconName}.png`),
            path.join(iconDir, theme, size, "apps", `${iconName}.svg`),
            path.join(iconDir, theme, size, "mimetypes", `${iconName}.png`),
            path.join(iconDir, theme, size, "mimetypes", `${iconName}.svg`),
          ];

          for (const candidate of candidates) {
            const exists = await fsPromises.access(candidate).then(() => true).catch(() => false);
            if (exists) {
              const data = await fsPromises.readFile(candidate);
              const ext = path.extname(candidate).toLowerCase();
              const mime = ext === ".svg" ? "image/svg+xml" : "image/png";
              return `data:${mime};base64,${data.toString("base64")}`;
            }
          }
        }
      }
    }

    const pixmapCandidates = [
      path.join("/usr/share/pixmaps", `${iconName}.png`),
      path.join("/usr/share/pixmaps", `${iconName}.svg`),
      path.join("/usr/share/pixmaps", iconName),
    ];

    for (const candidate of pixmapCandidates) {
      const exists = await fsPromises.access(candidate).then(() => true).catch(() => false);
      if (exists) {
        const data = await fsPromises.readFile(candidate);
        const ext = path.extname(candidate).toLowerCase();
        const mime = ext === ".svg" ? "image/svg+xml" : "image/png";
        return `data:${mime};base64,${data.toString("base64")}`;
      }
    }
  } catch {
    // Not found
  }

  return undefined;
}
