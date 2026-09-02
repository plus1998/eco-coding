import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type GeneratedImageFile,
  ImageGenerationError,
  type ImageGenerationToolInput,
} from "../shared/image-generation";
import type { ImageGenerationClientConfig } from "./image-generation-store";

const REQUEST_TIMEOUT_MS = 180_000;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const OPENAI_SIZES = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);
const GEMINI_SIZES = new Set(["1K", "2K", "4K"]);
const GEMINI_ASPECT_RATIOS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

interface ImagePayload {
  bytes: Buffer;
  mimeType: string;
}

export async function generateImagesToWorkspace(input: {
  config: ImageGenerationClientConfig;
  toolInput: ImageGenerationToolInput;
  generationRoot: string;
  threadDirectory: string;
  signal?: AbortSignal;
}): Promise<GeneratedImageFile[]> {
  const args = normalizeToolInput(input.toolInput, input.config.provider);
  const payloads =
    input.config.provider === "gemini"
      ? await generateGemini(input.config, args, input.signal)
      : await generateOpenAi(input.config, args, input.signal);
  if (payloads.length === 0) {
    throw new ImageGenerationError("empty_response", "供应商未返回任何图片。");
  }
  return writeImages(payloads, {
    generationRoot: input.generationRoot,
    threadDirectory: input.threadDirectory,
    ...(args.output_name ? { outputName: args.output_name } : {}),
  });
}

export function normalizeImageGenerationToolInput(
  input: ImageGenerationToolInput,
  provider: ImageGenerationClientConfig["provider"],
): ImageGenerationToolInput {
  return normalizeToolInput(input, provider);
}

function normalizeToolInput(
  input: ImageGenerationToolInput,
  provider: ImageGenerationClientConfig["provider"],
): Required<Pick<ImageGenerationToolInput, "prompt" | "count">> &
  Omit<ImageGenerationToolInput, "prompt" | "count"> {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) throw new ImageGenerationError("invalid_prompt", "prompt 不能为空。");
  if (prompt.length > 32_000) {
    throw new ImageGenerationError("invalid_prompt", "prompt 不能超过 32000 个字符。");
  }
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new ImageGenerationError("unsupported_parameter", "count 必须是 1 到 4 的整数。");
  }
  const size = input.size?.trim();
  const aspectRatio = input.aspect_ratio?.trim();
  if (provider === "gemini") {
    if (count !== 1) {
      throw new ImageGenerationError("unsupported_parameter", "Gemini 渠道首版只支持 count=1。");
    }
    if (size && !GEMINI_SIZES.has(size.toUpperCase())) {
      throw new ImageGenerationError("unsupported_parameter", "Gemini size 仅支持 1K、2K 或 4K。");
    }
    if (aspectRatio && !GEMINI_ASPECT_RATIOS.has(aspectRatio)) {
      throw new ImageGenerationError(
        "unsupported_parameter",
        `Gemini aspect_ratio 不受支持：${aspectRatio}。`,
      );
    }
    if (input.quality !== undefined) {
      throw new ImageGenerationError("unsupported_parameter", "Gemini 渠道不支持 quality 参数。");
    }
  } else {
    if (size && provider === "openai" && !OPENAI_SIZES.has(size)) {
      throw new ImageGenerationError(
        "unsupported_parameter",
        "OpenAI size 仅支持 auto、1024x1024、1536x1024 或 1024x1536。",
      );
    }
    if (aspectRatio) {
      throw new ImageGenerationError("unsupported_parameter", "OpenAI-style 渠道不支持 aspect_ratio 参数。");
    }
  }
  const outputName = input.output_name?.trim();
  if (outputName && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(outputName) || outputName.includes(".."))) {
    throw new ImageGenerationError(
      "invalid_output_name",
      "output_name 只能包含字母、数字、点、下划线和连字符，且不能包含路径片段。",
    );
  }
  return {
    prompt,
    count,
    ...(size ? { size: provider === "gemini" ? size.toUpperCase() : size } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(outputName ? { output_name: outputName } : {}),
  };
}

async function generateOpenAi(
  config: ImageGenerationClientConfig,
  args: ReturnType<typeof normalizeToolInput>,
  signal?: AbortSignal,
): Promise<ImagePayload[]> {
  const endpoint = `${config.endpoint.replace(/\/images\/generations\/?$/i, "")}/images/generations`;
  const body = {
    model: config.model,
    prompt: args.prompt,
    n: args.count,
    ...(args.size ? { size: args.size } : {}),
    ...(args.quality ? { quality: args.quality } : {}),
  };
  const response = await providerFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    signal,
  );
  const json = await readProviderJson(response);
  if (!response.ok) throw providerHttpError(response, json);
  const data = Array.isArray(json.data) ? json.data : undefined;
  if (!data) throw new ImageGenerationError("invalid_response", "OpenAI-style 响应缺少 data 数组。");
  const images: ImagePayload[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    if (typeof entry.b64_json === "string" && entry.b64_json) {
      images.push(validateImagePayload(Buffer.from(entry.b64_json, "base64"), undefined));
      continue;
    }
    if (typeof entry.url === "string" && entry.url) {
      images.push(await fetchProviderImage(entry.url, signal));
    }
  }
  if (images.length !== args.count) {
    throw new ImageGenerationError(
      "partial_response",
      `供应商请求 ${args.count} 张图片，但只返回 ${images.length} 张。`,
    );
  }
  return images;
}

async function generateGemini(
  config: ImageGenerationClientConfig,
  args: ReturnType<typeof normalizeToolInput>,
  signal?: AbortSignal,
): Promise<ImagePayload[]> {
  const base = config.endpoint.replace(/\/models(?:\/.*)?$/i, "");
  const endpoint = `${base}/models/${encodeURIComponent(config.model)}:generateContent`;
  const imageConfig = {
    ...(args.size ? { imageSize: args.size } : {}),
    ...(args.aspect_ratio ? { aspectRatio: args.aspect_ratio } : {}),
  };
  const response = await providerFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
        },
      }),
    },
    signal,
  );
  const json = await readProviderJson(response);
  if (!response.ok) throw providerHttpError(response, json);
  const images: ImagePayload[] = [];
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts))
      continue;
    for (const part of candidate.content.parts) {
      if (!isRecord(part)) continue;
      const inline = isRecord(part.inlineData)
        ? part.inlineData
        : isRecord(part.inline_data)
          ? part.inline_data
          : undefined;
      if (!inline || typeof inline.data !== "string") continue;
      images.push(
        validateImagePayload(
          Buffer.from(inline.data, "base64"),
          typeof inline.mimeType === "string"
            ? inline.mimeType
            : typeof inline.mime_type === "string"
              ? inline.mime_type
              : undefined,
        ),
      );
    }
  }
  if (images.length !== 1) {
    throw new ImageGenerationError(
      "invalid_response",
      `Gemini 返回了 ${images.length} 张图片，预期为 1 张。`,
    );
  }
  return images;
}

async function providerFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ImageGenerationError("timeout", "图片创建请求超时或已取消。");
    }
    throw new ImageGenerationError(
      "network_error",
      `图片创建网络请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function readProviderJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    const value = JSON.parse(text) as unknown;
    if (isRecord(value)) return value;
  } catch {
    // Report a bounded response below.
  }
  if (!response.ok) {
    return { error: { message: text.slice(0, 2_000) || `HTTP ${response.status}` } };
  }
  throw new ImageGenerationError("invalid_response", `供应商返回了非 JSON 响应：${text.slice(0, 300)}`);
}

function providerHttpError(response: Response, json: Record<string, unknown>): ImageGenerationError {
  const error = isRecord(json.error) ? json.error : undefined;
  const message =
    (typeof error?.message === "string" && error.message.trim()) ||
    (typeof json.message === "string" && json.message.trim()) ||
    `HTTP ${response.status}`;
  const code =
    response.status === 401 || response.status === 403
      ? "auth_failed"
      : response.status === 429
        ? "rate_limited"
        : "provider_error";
  const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
  return new ImageGenerationError(code, message.slice(0, 2_000), response.status, requestId);
}

async function fetchProviderImage(url: string, signal?: AbortSignal): Promise<ImagePayload> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageGenerationError("invalid_response", "供应商返回了无效图片 URL。");
  }
  if (parsed.protocol !== "https:" || isPrivateHost(parsed.hostname)) {
    throw new ImageGenerationError("unsafe_image_url", "供应商图片 URL 必须是非私网 HTTPS 地址。");
  }
  const response = await providerFetch(parsed.toString(), { method: "GET" }, signal);
  if (!response.ok) {
    throw new ImageGenerationError("image_download_failed", `下载供应商图片失败：HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new ImageGenerationError("image_too_large", "供应商图片超过 64 MB 限制。");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return validateImagePayload(bytes, response.headers.get("content-type") ?? undefined);
}

function validateImagePayload(bytes: Buffer, declaredMime?: string): ImagePayload {
  if (bytes.length === 0) throw new ImageGenerationError("invalid_response", "供应商返回了空图片。");
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new ImageGenerationError("image_too_large", "供应商图片超过 64 MB 限制。");
  const detected = detectImageMime(bytes);
  if (!detected)
    throw new ImageGenerationError("invalid_image", "供应商返回的数据不是受支持的 PNG、JPEG 或 WebP 图片。");
  if (
    declaredMime &&
    declaredMime.split(";")[0]?.trim() &&
    !declaredMime.toLowerCase().includes(detected.split("/")[1]!)
  ) {
    throw new ImageGenerationError("invalid_image", "供应商图片 MIME 与文件内容不一致。");
  }
  return { bytes, mimeType: detected };
}

async function writeImages(
  payloads: ImagePayload[],
  input: { generationRoot: string; threadDirectory: string; outputName?: string },
): Promise<GeneratedImageFile[]> {
  const outputDir = path.resolve(input.generationRoot, ".eco", "generated-images", input.threadDirectory);
  const allowedRoot = path.resolve(input.generationRoot, ".eco", "generated-images");
  if (outputDir !== allowedRoot && !outputDir.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new ImageGenerationError("invalid_output_path", "图片输出路径逃逸了工作目录。");
  }
  await fs.mkdir(outputDir, { recursive: true });
  const written: GeneratedImageFile[] = [];
  try {
    for (const [index, payload] of payloads.entries()) {
      const ext =
        payload.mimeType === "image/png" ? "png" : payload.mimeType === "image/jpeg" ? "jpg" : "webp";
      const prefix = input.outputName ?? `image-${Date.now()}`;
      const name = `${prefix}-${index + 1}-${randomUUID().slice(0, 8)}.${ext}`;
      const absolutePath = path.join(outputDir, name);
      const tempPath = `${absolutePath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, payload.bytes, { flag: "wx" });
      await fs.rename(tempPath, absolutePath);
      written.push({
        absolutePath,
        relativePath: path.relative(input.generationRoot, absolutePath),
        mimeType: payload.mimeType,
        bytes: payload.bytes.length,
      });
    }
    return written;
  } catch (error) {
    throw new ImageGenerationError(
      "write_failed",
      `保存图片失败：${error instanceof Error ? error.message : String(error)}`,
      undefined,
      undefined,
      written,
    );
  }
}

function detectImageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return undefined;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
