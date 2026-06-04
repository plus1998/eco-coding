#!/usr/bin/env node
/**
 * Build platform icons from repo-root logo.png into apps/desktop/packaging/.
 * Requires: macOS `sips` + `iconutil` for .icns; ImageMagick `magick` for .ico (and fallback).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const packagingDir = path.join(desktopRoot, "packaging");
const publicDir = path.join(desktopRoot, "public");
const sourceLogo = path.join(repoRoot, "logo.png");

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
  for (const [name, px] of sizes) {
    resizePng(input, path.join(iconsetDir, name), px);
  }
  run("iconutil", ["-c", "icns", iconsetDir, "-o", output]);
  fs.rmSync(iconsetDir, { force: true, recursive: true });
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

  resizePng(sourceLogo, pngOut, 512);
  fs.copyFileSync(pngOut, publicPng);
  buildIco(sourceLogo, icoOut);
  buildIcns(sourceLogo, icnsOut);

  console.log("Generated:");
  for (const file of [pngOut, icnsOut, icoOut, publicPng]) {
    if (fs.existsSync(file)) {
      console.log(`  ${path.relative(desktopRoot, file)}`);
    }
  }
}

main();
