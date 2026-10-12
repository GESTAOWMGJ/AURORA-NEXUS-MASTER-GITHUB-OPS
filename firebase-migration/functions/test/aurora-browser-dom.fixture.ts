import assert from "node:assert/strict";

export type Handler = (event?: any) => unknown;
export function addHandler(handlers: Map<string, Handler>, name: string, callback: Handler) {
  const previous = handlers.get(name);
  handlers.set(name, event => { const first = previous?.(event); return callback(event) ?? first; });
}

export class BrowserElement {
  id = ""; tagName: string; className = ""; hidden = false; disabled = false; value = ""; checked = false; colSpan = 0; tabIndex = 0;
  parentElement: BrowserElement | null = null; children: BrowserElement[] = [];
  handlers = new Map<string, Handler>(); attributes = new Map<string, string>(); dataset: Record<string, string> = {};
  ownerDocument?: { activeElement: BrowserElement | null };
  lastScroll: unknown; lastFocus: unknown; private text = "";
  constructor(id = "", tag = "div") { this.id = id; this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.text = String(value); for (const child of this.children) child.parentElement = null; this.children = []; }
  appendText(value: string) { this.text += value; }
  classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    add: (name: string) => { if (!this.classList.contains(name)) this.className = (this.className + " " + name).trim(); },
    remove: (name: string) => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(" "); },
    toggle: (name: string, force?: boolean) => { const active = force ?? !this.classList.contains(name); if (active) this.classList.add(name); else this.classList.remove(name); return active; }
  };
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = value;
    if (name === "class") this.className = value;
    if (name === "hidden") this.hidden = true;
    if (name === "disabled") this.disabled = true;
    if (name === "checked") this.checked = true;
    if (name === "value") this.value = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  getAttribute(name: string) { return name === "class" ? this.className : this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === "hidden") this.hidden = false; if (name === "disabled") this.disabled = false; }
  addEventListener(name: string, callback: Handler) { addHandler(this.handlers, name, callback); }
  appendChild(child: BrowserElement) { child.parentElement = this; child.ownerDocument = this.ownerDocument; this.children.push(child); return child; }
  append(...children: BrowserElement[]) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children: BrowserElement[]) { this.textContent = ""; this.append(...children); }
  matches(selector: string): boolean {
    if (/^[a-z][a-z0-9-]*$/i.test(selector)) return this.tagName.toLowerCase() === selector.toLowerCase();
    const attr = /^([a-z][a-z0-9-]*)?\[([a-z0-9-]+)(?:(\^?=)(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\](:checked)?$/i.exec(selector);
    assert.ok(attr, "Supported fixture selector: " + selector);
    if (attr[1] && this.tagName.toLowerCase() !== attr[1].toLowerCase()) return false;
    const value = this.getAttribute(attr[2]) ?? ((this as any)[attr[2]] === undefined ? null : String((this as any)[attr[2]]));
    if (value === null || (attr[7] && !this.checked)) return false;
    const expected = attr[4] ?? attr[5] ?? attr[6];
    return !attr[3] || (attr[3] === "^=" ? value.startsWith(expected) : value === expected);
  }
  closest(selector: string): BrowserElement | null { for (let node: BrowserElement | null = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector: string): BrowserElement[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(node: BrowserElement) { return node === this || this.children.some(child => child.contains(node)); }
  reset() { for (const element of this.querySelectorAll("input").concat(this.querySelectorAll("textarea"), this.querySelectorAll("select"))) { element.value = element.attributes.get("value") ?? ""; element.checked = element.attributes.has("checked"); } }
  scrollIntoView(options?: unknown) { this.lastScroll = options; }
  focus(options?: unknown) { this.lastFocus = options; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function fixtureDom(html: string) {
  const elements = new Map<string, BrowserElement>();
  const handlers = new Map<string, Handler>();
  const root = new BrowserElement("", "fixture-root");
  const document = {
    visibilityState: "visible", activeElement: null as BrowserElement | null,
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => { const element = new BrowserElement("", tag); element.ownerDocument = document; return element; },
    addEventListener: (name: string, callback: Handler) => addHandler(handlers, name, callback),
    dispatchEvent: (event: { type: string }) => { handlers.get(event.type)?.(event); return true; },
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    querySelector: (selector: string) => root.querySelector(selector)
  };
  root.ownerDocument = document;
  // This fixture parses the controlled emitted markup and preserves real parent
  // relationships. Script/style bodies are inert and never manufacture DOM ids.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const stack = [root]; let cursor = 0;
  for (const tag of markup.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    stack.at(-1)!.appendText(decode(markup.slice(cursor, tag.index)));
    cursor = tag.index! + tag[0].length;
    const name = tag[1].toLowerCase();
    if (tag[0].startsWith("</")) { const position = stack.findLastIndex(node => node.tagName.toLowerCase() === name); if (position > 0) stack.length = position; continue; }
    const element = document.createElement(name);
    for (const attribute of tag[2].matchAll(/([a-z_:][a-z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi)) element.setAttribute(attribute[1].toLowerCase(), decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""));
    if (element.id) { assert.ok(!elements.has(element.id), "Unique emitted DOM id: " + element.id); elements.set(element.id, element); }
    stack.at(-1)!.appendChild(element);
    if (!voidTags.has(name)) stack.push(element);
  }
  return { elements, document, handlers, root };
}
