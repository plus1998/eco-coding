/**
 * Names + input schemas for agent-browser `--tools core`, pinned to agent-browser@0.33.2.
 * Used so tools/list can advertise the surface without spawning a CDP child.
 *
 * Schemas must match {@link mapAgentBrowserToolToCliArgs} / BrowserHost native paths —
 * empty `properties: {}` caused Claude to omit `url` for agent_browser_open.
 */

export const AGENT_BROWSER_CORE_TOOL_NAMES = [
  "agent_browser_tools_profiles",
  "agent_browser_open",
  "agent_browser_read",
  "agent_browser_snapshot",
  "agent_browser_back",
  "agent_browser_forward",
  "agent_browser_reload",
  "agent_browser_click",
  "agent_browser_fill",
  "agent_browser_type",
  "agent_browser_press",
  "agent_browser_check",
  "agent_browser_uncheck",
  "agent_browser_select",
  "agent_browser_scroll",
  "agent_browser_wait_ms",
  "agent_browser_wait_for_selector",
  "agent_browser_wait_for_text",
  "agent_browser_wait_for_load",
  "agent_browser_screenshot",
  "agent_browser_get_text",
  "agent_browser_get_url",
  "agent_browser_get_title",
  "agent_browser_tab_new",
  "agent_browser_tab_list",
  "agent_browser_tab_switch",
  "agent_browser_tab_close",
  "agent_browser_eval",
  "agent_browser_close",
] as const;

type JsonSchema = Record<string, unknown>;

const emptyObjectSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: [],
};

const refOrSelector: JsonSchema = {
  type: "string",
  description: "Element ref from snapshot (e.g. e12) or CSS selector.",
};

function objectSchema(input: {
  properties: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
}): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: input.properties,
    required: input.required ?? [],
    ...(input.description ? { description: input.description } : {}),
  };
}

const TOOL_DEFINITIONS: Record<
  (typeof AGENT_BROWSER_CORE_TOOL_NAMES)[number],
  { description: string; inputSchema: JsonSchema }
> = {
  agent_browser_tools_profiles: {
    description: "List Eco built-in browser tool profiles / skills.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_open: {
    description:
      "Navigate the UI-focused tab to a URL (creates the first tab when none exist). Requires url.",
    inputSchema: objectSchema({
      required: ["url"],
      properties: {
        url: {
          type: "string",
          minLength: 1,
          description: "Absolute URL to open (http/https or about:).",
        },
      },
    }),
  },
  agent_browser_read: {
    description: "Read page content. Optional url navigates first.",
    inputSchema: objectSchema({
      properties: {
        url: { type: "string", description: "Optional URL to open before reading." },
      },
    }),
  },
  agent_browser_snapshot: {
    description: "Accessibility snapshot of the focused tab (use refs for click/fill).",
    inputSchema: objectSchema({
      properties: {
        interactive: {
          type: "boolean",
          description: "When true, only interactive elements.",
        },
      },
    }),
  },
  agent_browser_back: {
    description: "History back.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_forward: {
    description: "History forward.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_reload: {
    description: "Reload the focused tab.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_click: {
    description: "Click an element by snapshot ref or selector.",
    inputSchema: objectSchema({
      required: ["ref"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref (CSS selector)." },
      },
    }),
  },
  agent_browser_fill: {
    description: "Fill an input (clears then types).",
    inputSchema: objectSchema({
      required: ["ref", "text"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
        text: { type: "string", description: "Text to fill." },
      },
    }),
  },
  agent_browser_type: {
    description: "Type into an element without clearing first.",
    inputSchema: objectSchema({
      required: ["ref", "text"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
        text: { type: "string", description: "Text to type." },
      },
    }),
  },
  agent_browser_press: {
    description: "Press a key (e.g. Enter, Tab, Escape).",
    inputSchema: objectSchema({
      required: ["key"],
      properties: {
        key: { type: "string", minLength: 1, description: "Key name." },
      },
    }),
  },
  agent_browser_check: {
    description: "Check a checkbox/radio.",
    inputSchema: objectSchema({
      required: ["ref"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
      },
    }),
  },
  agent_browser_uncheck: {
    description: "Uncheck a checkbox.",
    inputSchema: objectSchema({
      required: ["ref"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
      },
    }),
  },
  agent_browser_select: {
    description: "Select option(s) in a <select>.",
    inputSchema: objectSchema({
      required: ["ref"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
        values: {
          type: "array",
          items: { type: "string" },
          description: "Option values to select.",
        },
        value: { type: "string", description: "Single option value." },
      },
    }),
  },
  agent_browser_scroll: {
    description: "Scroll the page.",
    inputSchema: objectSchema({
      properties: {
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction (default down).",
        },
        amount: { type: "number", description: "Pixels to scroll." },
      },
    }),
  },
  agent_browser_wait_ms: {
    description: "Wait a fixed number of milliseconds.",
    inputSchema: objectSchema({
      required: ["ms"],
      properties: {
        ms: { type: "number", minimum: 0, description: "Milliseconds to wait." },
      },
    }),
  },
  agent_browser_wait_for_selector: {
    description: "Wait until a selector/ref is present.",
    inputSchema: objectSchema({
      required: ["ref"],
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
      },
    }),
  },
  agent_browser_wait_for_text: {
    description: "Wait until text appears on the page.",
    inputSchema: objectSchema({
      required: ["text"],
      properties: {
        text: { type: "string", minLength: 1, description: "Text to wait for." },
      },
    }),
  },
  agent_browser_wait_for_load: {
    description: "Wait for page load.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_screenshot: {
    description: "Capture a screenshot of the focused tab.",
    inputSchema: objectSchema({
      properties: {
        path: {
          type: "string",
          description: "Optional absolute path to write the PNG.",
        },
      },
    }),
  },
  agent_browser_get_text: {
    description: "Get text content of the page or an element.",
    inputSchema: objectSchema({
      properties: {
        ref: refOrSelector,
        selector: { type: "string", description: "Alias of ref." },
      },
    }),
  },
  agent_browser_get_url: {
    description: "Get the focused tab URL.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_get_title: {
    description: "Get the focused tab title.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_tab_new: {
    description: "Open a background tab (does not steal UI focus). Optional url.",
    inputSchema: objectSchema({
      properties: {
        url: { type: "string", description: "Optional URL for the new tab." },
      },
    }),
  },
  agent_browser_tab_list: {
    description: "List tabs in this Eco browser session.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_tab_switch: {
    description: "Switch the UI-focused tab (e.g. t1, t2, or 1-based index).",
    inputSchema: objectSchema({
      properties: {
        tab: {
          type: "string",
          description: "Tab id like t1 / t2, or numeric index string.",
        },
        index: { type: "number", description: "1-based tab index." },
      },
    }),
  },
  agent_browser_tab_close: {
    description: "Close the focused tab.",
    inputSchema: emptyObjectSchema,
  },
  agent_browser_eval: {
    description: "Evaluate JavaScript in the page.",
    inputSchema: objectSchema({
      required: ["script"],
      properties: {
        script: {
          type: "string",
          minLength: 1,
          description: "JavaScript expression or script to evaluate.",
        },
      },
    }),
  },
  agent_browser_close: {
    description: "Close the Eco built-in browser session for this thread.",
    inputSchema: emptyObjectSchema,
  },
};

export function agentBrowserCoreToolsCatalog(): Array<Record<string, unknown>> {
  return AGENT_BROWSER_CORE_TOOL_NAMES.map((name) => {
    const def = TOOL_DEFINITIONS[name];
    return {
      name,
      description: def.description,
      inputSchema: def.inputSchema,
    };
  });
}
