interface AnsiStyle {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg?: string;
  bg?: string;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeCarriageReturns(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const lastCarriageReturn = line.lastIndexOf("\r");
      return lastCarriageReturn >= 0 ? line.slice(lastCarriageReturn + 1) : line;
    })
    .join("\n");
}

function cloneStyle(style: AnsiStyle): AnsiStyle {
  return { ...style };
}

function applySgrCodes(style: AnsiStyle, rawCodes: string): void {
  const codes = rawCodes.length > 0 ? rawCodes.split(";").map((part) => Number(part)) : [0];
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (Number.isNaN(code)) {
      continue;
    }

    if (code === 0) {
      Object.assign(style, DEFAULT_STYLE);
      style.fg = undefined;
      style.bg = undefined;
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
      style.fg = undefined;
      continue;
    }
    if (code === 49) {
      style.bg = undefined;
      continue;
    }
    if (code === 38 || code === 48) {
      const mode = codes[index + 1];
      if (mode === 5 && codes[index + 2] !== undefined) {
        const paletteIndex = codes[index + 2];
        const color = `palette-${paletteIndex}`;
        if (code === 38) {
          style.fg = color;
        } else {
          style.bg = color;
        }
        index += 2;
        continue;
      }
      if (mode === 2 && codes[index + 4] !== undefined) {
        const red = codes[index + 2];
        const green = codes[index + 3];
        const blue = codes[index + 4];
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

function stylesEqual(left: AnsiStyle, right: AnsiStyle): boolean {
  return (
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.fg === right.fg &&
    left.bg === right.bg
  );
}

function styleToClasses(style: AnsiStyle): string {
  const classes: string[] = [];
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
  if (style.fg) {
    classes.push(`ansi-fg-${style.fg}`);
  }
  if (style.bg) {
    classes.push(`ansi-bg-${style.bg}`);
  }
  return classes.join(" ");
}

function renderChunk(chunk: string, style: AnsiStyle): string {
  if (!chunk) {
    return "";
  }
  const escaped = escapeHtml(chunk);
  const classes = styleToClasses(style);
  return classes ? `<span class="${classes}">${escaped}</span>` : escaped;
}

function findCsiEnd(value: string, start: number): number {
  for (let index = start + 2; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return -1;
}

function isEscapeStart(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code === 0x1b || code === 0x9b;
}

export function ansiToHtml(value: string): string {
  const normalized = normalizeCarriageReturns(value);
  let result = "";
  let style = cloneStyle(DEFAULT_STYLE);
  let index = 0;

  while (index < normalized.length) {
    if (!isEscapeStart(normalized, index)) {
      const nextEscape = normalized.slice(index).search(/\u001b|\u009b/);
      const end = nextEscape === -1 ? normalized.length : index + nextEscape;
      result += renderChunk(normalized.slice(index, end), style);
      index = end;
      continue;
    }

    if (normalized[index] === "\u009b" || normalized[index + 1] === "[") {
      const bracketIndex = normalized[index] === "\u009b" ? index + 1 : index + 1;
      if (normalized[bracketIndex] === "[") {
        const csiEnd = findCsiEnd(normalized, bracketIndex - 1);
        if (csiEnd !== -1) {
          const terminator = normalized[csiEnd];
          const bodyStart = bracketIndex + 1;
          const body = normalized.slice(bodyStart, csiEnd);
          if (terminator === "m" && /^[0-9;]*$/.test(body)) {
            applySgrCodes(style, body);
          }
          index = csiEnd + 1;
          continue;
        }
      }
    }

    if (normalized[index] === "\u001b" && normalized[index + 1] !== "[") {
      index += 2;
      continue;
    }

    index += 1;
  }

  return result;
}

export function hasAnsi(value: string): boolean {
  return /\u001b\[[0-9;]*m|\u009b\[[0-9;]*m/.test(value);
}
