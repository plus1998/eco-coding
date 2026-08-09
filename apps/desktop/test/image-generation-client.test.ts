import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  generateImagesToWorkspace,
  normalizeImageGenerationToolInput,
} from "../src/main/image-generation-client";
import { ImageGenerationError } from "../src/shared/image-generation";
import type { ImageGenerationClientConfig } from "../src/main/image-generation-store";

const originalFetch = globalThis.fetch;
const temporaryDirectories: string[] = [];
const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function generationRoot(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eco-image-client-"));
  temporaryDirectories.push(directory);
  return directory;
}

function config(provider: ImageGenerationClientConfig["provider"]): ImageGenerationClientConfig {
  return {
    profileId: "profile-1",
    profileName: "Primary",
    provider,
    endpoint:
      provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "https://api.example.com/v1",
    model: provider === "gemini" ? "gemini-image" : "exact-image-model",
    apiKey: "secret-key",
  };
}

test("OpenAI request preserves model and parameters and writes under the thread directory", async () => {
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (url, init) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const root = await generationRoot();
  const images = await generateImagesToWorkspace({
    config: config("openai"),
    toolInput: {
      prompt: "Draw a blue cube",
      size: "1536x1024",
      quality: "high",
      count: 1,
      output_name: "cube",
    },
    generationRoot: root,
    threadDirectory: "thread-safe",
  });

  expect(requestedUrl).toBe("https://api.example.com/v1/images/generations");
  expect(requestedBody).toEqual({
    model: "exact-image-model",
    prompt: "Draw a blue cube",
    n: 1,
    size: "1536x1024",
    quality: "high",
  });
  expect(images[0]?.relativePath).toStartWith(
    path.join(".eco", "generated-images", "thread-safe", "cube-1-"),
  );
  expect(await fs.readFile(images[0]!.absolutePath)).toEqual(Buffer.from(pngBase64, "base64"));
});

test("Gemini request uses imageConfig without inventing OpenAI fields", async () => {
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url, init) => {
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { data: pngBase64, mimeType: "image/png" } }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  await generateImagesToWorkspace({
    config: config("gemini"),
    toolInput: { prompt: "Portrait", size: "2k", aspect_ratio: "3:4", count: 1 },
    generationRoot: await generationRoot(),
    threadDirectory: "thread-gemini",
  });
  expect(requestedBody).toEqual({
    contents: [{ role: "user", parts: [{ text: "Portrait" }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { imageSize: "2K", aspectRatio: "3:4" },
    },
  });
});

test("provider-specific unsupported parameters fail with a stable error code", () => {
  for (const [provider, input] of [
    ["gemini", { prompt: "x", quality: "high" }],
    ["openai", { prompt: "x", aspect_ratio: "1:1" }],
    ["openai", { prompt: "x", size: "512x512" }],
  ] as const) {
    try {
      normalizeImageGenerationToolInput(input, provider);
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ImageGenerationError);
      expect((error as ImageGenerationError).code).toBe("unsupported_parameter");
    }
  }
});

test("invalid image bytes are returned as an Agent-visible stable error", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not-image").toString("base64") }] }), {
      status: 200,
    })) as typeof fetch;
  try {
    await generateImagesToWorkspace({
      config: config("openai_compatible"),
      toolInput: { prompt: "x" },
      generationRoot: await generationRoot(),
      threadDirectory: "thread-error",
    });
    throw new Error("expected invalid image failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ImageGenerationError);
    expect((error as ImageGenerationError).code).toBe("invalid_image");
  }
});
