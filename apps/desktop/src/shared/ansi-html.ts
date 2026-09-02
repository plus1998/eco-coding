interface AnsiStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg?: string | undefined;
  bg?: string | undefined;
}

const DEFAULT_STYLE: AnsiStyle = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

const STANDARD_FG: Record<number, string> = {
  30: "black",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "bright-black",
  91: "bright-red",
  92: "bright-green",
  93: "bright-yellow",
  94: "bright-blue",
  95: "bright-magenta",
  96: "bright-cyan",
  97: "bright-white",
};

const STANDARD_BG: Record<number, string> = {
  40: "black",
  41: "red",
  42: "green",
  43: "yellow",
  44: "blue",
  45: "magenta",
  46: "cyan",
  47: "white",
  100: "bright-black",
  101: "bright-red",
  102: "bright-green",
  103: "bright-yellow",
  104: "bright-blue",
  105: "bright-magenta",
  106: "bright-cyan",
  107: "bright-white",
};

const XTERM_16: readonly string[] = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

// Log viewer: keep all emitted lines instead of emulating interactive \r overwrites.
function normalizeTerminalOutput(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

function cloneStyle(style: AnsiStyle): AnsiStyle {
  return { ...style };
}

function xterm256Color(index: number): string {
  if (index < 0 || index > 255) {
    return "inherit";
  }
  if (index < 16) {
    return XTERM_16[index] ?? "inherit";
  }
  if (index < 232) {
    const cubeIndex = index - 16;
    const red = Math.floor(cubeIndex / 36);
    const green = Math.floor((cubeIndex % 36) / 6);
    const blue = cubeIndex % 6;
    const toComponent = (component: number) => (component === 0 ? 0 : 55 + component * 40);
    return `rgb(${toComponent(red)}, ${toComponent(green)}, ${toComponent(blue)})`;
  }
  const gray = 8 + (index - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

function applySgrCodes(style: AnsiStyle, rawCodes: string): void {
  const codes = rawCodes.length > 0 ? rawCodes.split(";").map((part) => Number(part)) : [0];
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === undefined || Number.isNaN(code)) {
      continue;
    }

    if (code === 0) {
      Object.assign(style, DEFAULT_STYLE);
      delete style.fg;
      delete style.bg;
      continue;
    }
    if (code === 1) {
      style.bold = true;
      continue;
    }
    if (code === 2) {
      style.dim = true;
      continue;
    }
    if (code === 3) {
      style.italic = true;
      continue;
    }
    if (code === 4) {
      style.underline = true;
      continue;
    }
    if (code === 22) {
      style.bold = false;
      style.dim = false;
      continue;
    }
    if (code === 23) {
      style.italic = false;
      continue;
    }
    if (code === 24) {
      style.underline = false;
      continue;
    }
    if (code === 39) {
      delete style.fg;
      continue;
    }
    if (code === 49) {
      delete style.bg;
      continue;
    }
    if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      const paletteIndex = codes[index + 2];
      if (mode === 5 && paletteIndex !== undefined) {
        const color = `palette-${paletteIndex}`;
        if (code === 38) {
          style.fg = color;
        } else {
          style.bg = color;
        }
        index += 2;
        continue;
      }
      const red = codes[index + 2];
      const green = codes[index + 3];
      const blue = codes[index + 4];
      if (mode === 2 && red !== undefined && green !== undefined && blue !== undefined) {
        const color = `rgb-${red}-${green}-${blue}`;
        if (code === 38) {
          style.fg = color;
        } else {
          style.bg = color;
        }
        index += 4;
      }
      continue;
    }

    const fg = STANDARD_FG[code];
    if (fg) {
      style.fg = fg;
      continue;
    }
    const bg = STANDARD_BG[code];
    if (bg) {
      style.bg = bg;
    }
  }
}

function resolveColorToken(token: string | undefined, kind: "fg" | "bg"): string | undefined {
  if (!token) {
    return undefined;
  }
  if (token.startsWith("palette-")) {
    const index = Number(token.slice("palette-".length));
    if (!Number.isNaN(index)) {
      return xterm256Color(index);
    }
    return undefined;
  }
  if (token.startsWith("rgb-")) {
    const [red, green, blue] = token.slice("rgb-".length).split("-").map(Number);
    if ([red, green, blue].every((component) => !Number.isNaN(component))) {
      return `rgb(${red}, ${green}, ${blue})`;
    }
    return undefined;
  }

  const className = `ansi-${kind}-${token}`;
  return `var(--ansi-${kind}-${token}, inherit)`;
}

function styleToAttributes(style: AnsiStyle): { className?: string; style?: string } {
  const classes: string[] = [];
  const styles: string[] = [];

  if (style.bold) {
    classes.push("ansi-bold");
  }
  if (style.dim) {
    classes.push("ansi-dim");
  }
  if (style.italic) {
    classes.push("ansi-italic");
  }
  if (style.underline) {
    classes.push("ansi-underline");
  }

  const foreground = resolveColorToken(style.fg, "fg");
  if (foreground) {
    if (style.fg?.startsWith("palette-") || style.fg?.startsWith("rgb-")) {
      styles.push(`color: ${foreground}`);
    } else {
      classes.push(`ansi-fg-${style.fg}`);
    }
  }

  const background = resolveColorToken(style.bg, "bg");
  if (background) {
    if (style.bg?.startsWith("palette-") || style.bg?.startsWith("rgb-")) {
      styles.push(`background-color: ${background}`);
    } else {
      classes.push(`ansi-bg-${style.bg}`);
    }
  }

  return {
    ...(classes.length > 0 ? { className: classes.join(" ") } : {}),
    ...(styles.length > 0 ? { style: styles.join("; ") } : {}),
  };
}

function renderChunk(chunk: string, style: AnsiStyle): string {
  if (!chunk) {
    return "";
  }
  const escaped = escapeHtml(chunk);
  const attributes = styleToAttributes(style);
  if (!attributes.className && !attributes.style) {
    return escaped;
  }
  const classAttr = attributes.className ? ` class="${attributes.className}"` : "";
  const styleAttr = attributes.style ? ` style="${escapeAttribute(attributes.style)}"` : "";
  return `<span${classAttr}${styleAttr}>${escaped}</span>`;
}

function consumeCsi(value: string, index: number): { nextIndex: number; sgrBody?: string } {
  if (value[index] === "\u001b") {
    if (value[index + 1] !== "[") {
      return { nextIndex: index + 2 };
    }
    return readCsiBody(value, index + 2, index);
  }
  if (value[index] === "\u009b") {
    return readCsiBody(value, index + 1, index);
  }
  return { nextIndex: index + 1 };
}

function readCsiBody(
  value: string,
  paramStart: number,
  escapeStart: number,
): { nextIndex: number; sgrBody?: string } {
  for (let end = paramStart; end < value.length; end += 1) {
    const code = value.charCodeAt(end);
    if (code >= 0x40 && code <= 0x7e) {
      const terminator = value[end];
      const body = value.slice(paramStart, end);
      if (terminator === "m" && /^[0-9;]*$/.test(body)) {
        return { nextIndex: end + 1, sgrBody: body };
      }
      return { nextIndex: end + 1 };
    }
  }
  return { nextIndex: value.length };
}

function isEscapeStart(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code === 0x1b || code === 0x9b;
}

export function ansiToHtml(value: string): string {
  const normalized = normalizeTerminalOutput(value);
  let result = "";
  const style = cloneStyle(DEFAULT_STYLE);
  let index = 0;

  while (index < normalized.length) {
    if (!isEscapeStart(normalized, index)) {
      const nextEscape = normalized.slice(index).search(/\u001b|\u009b/);
      const end = nextEscape === -1 ? normalized.length : index + nextEscape;
      result += renderChunk(normalized.slice(index, end), style);
      index = end;
      continue;
    }

    const consumed = consumeCsi(normalized, index);
    if (consumed.sgrBody !== undefined) {
      applySgrCodes(style, consumed.sgrBody);
    }
    index = consumed.nextIndex;
  }

  return result;
}

export function hasAnsi(value: string): boolean {
  return /\u001b\[[0-9;]*m|\u009b[0-9;]*m/.test(value);
}
