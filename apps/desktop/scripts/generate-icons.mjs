#!/usr/bin/env node
/**
 * Build platform icons from repo-root logo.png into apps/desktop/packaging/.
 * Requires: macOS `sips` + `iconutil` for .icns; ImageMagick `magick` for masks and .ico.
 *
 * Source logo stays full-bleed square. Platform exports bake shape when the OS
 * does not reliably apply a live product-icon mask (Windows, macOS .icns/DMG).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const packagingDir = path.join(desktopRoot, "packaging");
const publicDir = path.join(desktopRoot, "public");
const sourceLogo = path.join(repoRoot, "logo.png");

/** Windows shell-style corner relative to edge (~14% at 512 → radius 72). */
const WINDOWS_CORNER_FRACTION = 72 / 512;

/**
 * Approximate continuous-corner radius for a full-bleed macOS product icon
 * (≈22.37% of edge; common 1024 template scale).
 */
const MACOS_CORNER_FRACTION = 0.2237;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${result.status ?? "unknown"})`);
  }
}

function requireCommand(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Missing required command: ${name}`);
  }
  return result.stdout.trim();
}

function resizePng(input, output, size) {
  requireCommand("sips");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  run("sips", ["-z", String(size), String(size), input, "--out", output]);
}

/**
 * Copy RGB from input and replace alpha with a white/transparent rounded mask.
 * Supersample then downscale for soft corner AA.
 */
function buildRoundedProductPng(input, output, size, cornerFraction) {
  const magick = requireCommand("magick");
  const supersample = size * 2;
  const radius = Math.round(supersample * cornerFraction);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  run(magick, [
    input,
    "-resize",
    `${size}x${size}!`,
    "-alpha",
    "on",
    "(",
    "-size",
    `${supersample}x${supersample}`,
    "xc:none",
    "-fill",
    "white",
    "-draw",
    `roundrectangle 0,0 ${supersample - 1},${supersample - 1} ${radius},${radius}`,
    "-resize",
    `${size}x${size}`,
    ")",
    "-alpha",
    "off",
    "-compose",
    "CopyOpacity",
    "-composite",
    // iconutil is picky about PNG encoding; stick to 8-bit sRGB RGBA.
    "-strip",
    "-define",
    "png:color-type=6",
    "-define",
    "png:bit-depth=8",
    output,
  ]);
}

// Windows displays the alpha channel as-is, so bake rounded corners into the ICO input.
function buildWindowsRoundedPng(input, output, size = 512) {
  buildRoundedProductPng(input, output, size, WINDOWS_CORNER_FRACTION);
}

// macOS .icns is drawn as a static bitmap in DMG / some Finder surfaces.
// Bake rounded alpha so App + DMG share one pre-shaped product icon.
function buildMacOsProductPng(input, output, size = 1024) {
  buildRoundedProductPng(input, output, size, MACOS_CORNER_FRACTION);
}

function buildIcns(input, output) {
  if (process.platform !== "darwin") {
    console.warn("Skipping icon.icns (iconutil is macOS-only). Pack macOS builds on darwin or commit icon.icns.");
    return;
  }
  requireCommand("sips");
  requireCommand("iconutil");
  const iconsetDir = path.join(packagingDir, "Eco.iconset");
  fs.rmSync(iconsetDir, { force: true, recursive: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
  const sizes = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  try {
    for (const [name, px] of sizes) {
      resizePng(input, path.join(iconsetDir, name), px);
    }
    run("iconutil", ["-c", "icns", iconsetDir, "-o", output]);
  } finally {
    fs.rmSync(iconsetDir, { force: true, recursive: true });
  }
}

function buildIco(input, output) {
  const magick = requireCommand("magick");
  run(magick, [input, "-define", "icon:auto-resize=256,128,64,48,32,16", output]);
}

function main() {
  if (!fs.existsSync(sourceLogo)) {
    console.error(`Source logo not found: ${sourceLogo}`);
    process.exit(1);
  }
  fs.mkdirSync(packagingDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const pngOut = path.join(packagingDir, "icon.png");
  const icnsOut = path.join(packagingDir, "icon.icns");
  const icoOut = path.join(packagingDir, "icon.ico");
  const publicPng = path.join(publicDir, "icon.png");
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "eco-coding-icons-"));
  const windowsPng = path.join(temporaryDir, "icon-windows-rounded.png");
  const macPng = path.join(temporaryDir, "icon-macos-rounded.png");

  try {
    // Square master for Linux / generic PNG and public favicon-style use.
    resizePng(sourceLogo, pngOut, 512);
    fs.copyFileSync(pngOut, publicPng);

    buildWindowsRoundedPng(sourceLogo, windowsPng, 512);
    buildIco(windowsPng, icoOut);

    // One masked master → all .icns sizes (App, Dock source, DMG volume).
    buildMacOsProductPng(sourceLogo, macPng, 1024);
    buildIcns(macPng, icnsOut);
  } finally {
    fs.rmSync(temporaryDir, { force: true, recursive: true });
  }

  console.log("Generated:");
  for (const file of [pngOut, icnsOut, icoOut, publicPng]) {
    if (fs.existsSync(file)) {
      console.log(`  ${path.relative(desktopRoot, file)}`);
    }
  }
}

main();
