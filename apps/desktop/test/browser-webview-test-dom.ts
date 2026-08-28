type MockListener = () => void;

class MockDomNode {
  parentElement: MockDomElement | null = null;
  isConnected = false;

  remove(): void {
    this.parentElement?.removeChild(this);
  }
}

class MockDomElement extends MockDomNode {
  readonly tagName: string;
  className = "";
  readonly attributes = new Map<string, string>();
  readonly children: MockDomElement[] = [];
  partition = "";
  src = "about:blank";
  allowpopups = false;
  private readonly listeners = new Map<string, Set<MockListener>>();

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  get childElementCount(): number {
    return this.children.length;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...nodes: MockDomNode[]): void {
    for (const node of nodes) {
      if (!(node instanceof MockDomElement)) {
        continue;
      }
      if (node.parentElement) {
        node.parentElement.removeChild(node);
      }
      node.parentElement = this;
      this.children.push(node);
      node.isConnected = true;
    }
  }

  removeChild(node: MockDomNode): void {
    if (!(node instanceof MockDomElement) || node.parentElement !== this) {
      return;
    }
    node.parentElement = null;
    node.isConnected = false;
    const index = this.children.indexOf(node);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
  }

  querySelector(selector: string): MockDomElement | null {
    if (selector === "webview") {
      return this.children.find((child) => child.tagName === "WEBVIEW") ?? null;
    }
    return null;
  }

  addEventListener(type: string, listener: MockListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: MockListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  getWebContentsId(): number {
    return 42;
  }
}

let restoreDocument: (() => void) | undefined;

/** Minimal DOM for pool unit tests (bun has no jsdom by default). */
export function withBrowserWebviewTestDom<T>(run: () => T): T {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tagName: string) {
      return new MockDomElement(tagName) as unknown as HTMLElement;
    },
  } as Document;
  restoreDocument = () => {
    globalThis.document = previous;
  };
  try {
    return run();
  } finally {
    restoreDocument();
    restoreDocument = undefined;
  }
}

export function createMockHostSlot(): HTMLElement {
  return new MockDomElement("div") as unknown as HTMLElement;
}
