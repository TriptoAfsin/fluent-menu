// Lossless parser for Nilesoft Shell .nss config files.
//
// Every node keeps the exact source text it came from plus the whitespace/comments
// before it (`lead`). Serializing an unedited document reproduces the input byte for
// byte; only nodes marked dirty are regenerated from their properties. Anything the
// parser doesn't model (settings, modify, remove, import, $vars...) becomes a `raw`
// node that is preserved verbatim and can be edited as text.

export interface Prop {
  name: string;
  /** Raw value text exactly as written (`'x'`, `title.terminal`, `[a, b]`), or null for flags. */
  value: string | null;
}

interface Base {
  id: number;
  lead: string;
}

export interface ItemNode extends Base {
  kind: "item";
  props: Prop[];
  text: string;
  dirty: boolean;
}

export interface MenuNode extends Base {
  kind: "menu";
  props: Prop[];
  header: string;
  /** Text between the header's `)` and the children, including the `{`. */
  open: string;
  children: NssNode[];
  /** Trivia before the closing brace. */
  tail: string;
  close: string;
  dirty: boolean;
}

export interface SeparatorNode extends Base {
  kind: "separator";
  text: string;
}

export interface RawNode extends Base {
  kind: "raw";
  text: string;
}

export type NssNode = ItemNode | MenuNode | SeparatorNode | RawNode;

export interface NssDocument {
  nodes: NssNode[];
  tail: string;
}

let nextId = 1;
export const newId = () => nextId++;

class Scanner {
  pos = 0;
  constructor(readonly src: string) {}

  get done() {
    return this.pos >= this.src.length;
  }

  peek(offset = 0) {
    return this.src[this.pos + offset] ?? "";
  }

  /** Whitespace and comments. */
  trivia(): string {
    const start = this.pos;
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "﻿") {
        this.pos++;
      } else if (c === "/" && this.peek(1) === "/") {
        while (!this.done && this.peek() !== "\n") this.pos++;
      } else if (c === "/" && this.peek(1) === "*") {
        const end = this.src.indexOf("*/", this.pos + 2);
        this.pos = end < 0 ? this.src.length : end + 2;
      } else {
        break;
      }
    }
    return this.src.slice(start, this.pos);
  }

  ident(): string {
    const m = /^[A-Za-z_$][\w$.\-]*/.exec(this.src.slice(this.pos));
    if (!m) return "";
    this.pos += m[0].length;
    return m[0];
  }

  /** Skips a quoted string starting at pos. Double quotes honor backslash escapes. */
  string() {
    const q = this.peek();
    this.pos++;
    while (!this.done) {
      const c = this.peek();
      if (q === '"' && c === "\\") {
        this.pos += 2;
        continue;
      }
      this.pos++;
      if (c === q) return;
    }
  }

  /** Skips a balanced (), [] or {} group starting at pos, respecting strings and comments. */
  group() {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const stack: string[] = [];
    do {
      const c = this.peek();
      if (c === "'" || c === '"') {
        this.string();
        continue;
      }
      if (c === "/" && (this.peek(1) === "/" || this.peek(1) === "*")) {
        this.trivia();
        continue;
      }
      if (pairs[c]) stack.push(pairs[c]);
      else if (c === stack[stack.length - 1]) stack.pop();
      this.pos++;
    } while (stack.length && !this.done);
  }

  /** Skips to the end of the current line, jumping over brackets and strings. */
  restOfLine() {
    while (!this.done && this.peek() !== "\n") {
      const c = this.peek();
      if (c === "'" || c === '"') this.string();
      else if (c === "(" || c === "[" || c === "{") this.group();
      else if (c === "/" && this.peek(1) === "/") break;
      else this.pos++;
    }
  }
}

// ------------------------------------------------------------------ props

const OPERATOR = /^(==|!=|<=|>=|&&|\|\||[+\-*/<>|&]|or\b|and\b)/;

class PropScanner {
  pos = 0;
  constructor(readonly src: string) {}

  ws() {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (/\s|,/.test(c)) this.pos++;
      else if (c === "/" && this.src[this.pos + 1] === "*") {
        const end = this.src.indexOf("*/", this.pos + 2);
        this.pos = end < 0 ? this.src.length : end + 2;
      } else break;
    }
  }

  /** One operand: string, bracket group, or bare word with optional call parens. */
  term(): boolean {
    const s = new Scanner(this.src);
    s.pos = this.pos;
    while (s.peek() === "!" || (s.peek() === "-" && /[\d.]/.test(s.peek(1)))) s.pos++;
    const c = s.peek();
    if (c === "'" || c === '"') s.string();
    else if (c === "[" || c === "(") s.group();
    else {
      const m = /^[^\s()[\]'"=,!<>|&+*]+/.exec(this.src.slice(s.pos));
      if (!m) return false;
      s.pos += m[0].length;
      while (s.peek() === "(") s.group();
    }
    this.pos = s.pos;
    return true;
  }

  value(): string | null {
    const start = this.pos;
    if (!this.term()) return null;
    for (;;) {
      const save = this.pos;
      while (this.pos < this.src.length && /[ \t\r\n]/.test(this.src[this.pos])) this.pos++;
      const op = OPERATOR.exec(this.src.slice(this.pos));
      if (!op) {
        this.pos = save;
        break;
      }
      this.pos += op[0].length;
      while (this.pos < this.src.length && /[ \t\r\n]/.test(this.src[this.pos])) this.pos++;
      if (!this.term()) {
        this.pos = save;
        break;
      }
    }
    return this.src.slice(start, this.pos);
  }
}

/** Parses the inside of `item( ... )`. Returns null when it can't be understood. */
export function parseProps(inner: string): Prop[] | null {
  const ps = new PropScanner(inner);
  const props: Prop[] = [];
  for (;;) {
    ps.ws();
    if (ps.pos >= inner.length) return props;
    const m = /^[A-Za-z_][\w.\-]*/.exec(inner.slice(ps.pos));
    if (!m) return null;
    ps.pos += m[0].length;
    const afterName = ps.pos;
    while (ps.pos < inner.length && /[ \t]/.test(inner[ps.pos])) ps.pos++;
    if (inner[ps.pos] === "=" && inner[ps.pos + 1] !== "=") {
      ps.pos++;
      while (ps.pos < inner.length && /[ \t]/.test(inner[ps.pos])) ps.pos++;
      const v = ps.value();
      if (v === null) return null;
      props.push({ name: m[0], value: v });
    } else {
      ps.pos = afterName;
      props.push({ name: m[0], value: null });
    }
  }
}

// ------------------------------------------------------------------ document

function parseBlock(s: Scanner, nested: boolean): { nodes: NssNode[]; tail: string } {
  const nodes: NssNode[] = [];
  for (;;) {
    const lead = s.trivia();
    if (s.done || (nested && s.peek() === "}")) return { nodes, tail: lead };
    nodes.push(parseStatement(s, lead));
  }
}

function parseStatement(s: Scanner, lead: string): NssNode {
  const start = s.pos;
  const word = s.ident();
  const lower = word.toLowerCase();

  if ((lower === "item" || lower === "menu") && s.peek() === "(") {
    const argsStart = s.pos;
    s.group();
    const header = s.src.slice(start, s.pos);
    const props = parseProps(s.src.slice(argsStart + 1, s.pos - 1));
    if (props) {
      if (lower === "item") {
        return { kind: "item", id: newId(), lead, props, text: header, dirty: false };
      }
      const save = s.pos;
      const between = s.trivia();
      if (s.peek() === "{") {
        s.pos++;
        const body = parseBlock(s, true);
        const closed = s.peek() === "}";
        if (closed) s.pos++;
        return {
          kind: "menu",
          id: newId(),
          lead,
          props,
          header,
          open: between + "{",
          children: body.nodes,
          tail: body.tail,
          close: closed ? "}" : "",
          dirty: false,
        };
      }
      s.pos = save;
    }
    return { kind: "raw", id: newId(), lead, text: s.src.slice(start, s.pos) };
  }

  if ((lower === "separator" || lower === "sep") && !/[=]/.test(s.peek())) {
    if (s.peek() === "(") s.group();
    return { kind: "separator", id: newId(), lead, text: s.src.slice(start, s.pos) };
  }

  // Anything else: consume the line, plus a following { } block (e.g. `settings\n{ ... }`).
  if (!word) {
    // Stray character (e.g. an unmatched brace). Consume it so parsing always progresses.
    if (s.peek() === "{" || s.peek() === "(" || s.peek() === "[") s.group();
    else s.pos++;
  }
  s.restOfLine();
  const save = s.pos;
  while (/[ \t\r\n]/.test(s.peek())) s.pos++;
  if (s.peek() === "{") s.group();
  else s.pos = save;
  return { kind: "raw", id: newId(), lead, text: s.src.slice(start, s.pos) };
}

export function parse(src: string): NssDocument {
  const s = new Scanner(src);
  const { nodes, tail } = parseBlock(s, false);
  return { nodes, tail };
}

export function propsText(kind: "item" | "menu", props: Prop[]): string {
  const parts = props.map((p) => (p.value === null ? p.name : `${p.name}=${p.value}`));
  return `${kind}(${parts.join(" ")})`;
}

function nodeText(n: NssNode): string {
  switch (n.kind) {
    case "item":
      return n.dirty ? propsText("item", n.props) : n.text;
    case "menu":
      return (
        (n.dirty ? propsText("menu", n.props) : n.header) +
        n.open +
        n.children.map((c) => c.lead + nodeText(c)).join("") +
        n.tail +
        n.close
      );
    default:
      return n.text;
  }
}

export function serialize(doc: NssDocument): string {
  return doc.nodes.map((n) => n.lead + nodeText(n)).join("") + doc.tail;
}

// ------------------------------------------------------------------ values

export const isQuoted = (v: string | null) =>
  !!v && v.length >= 2 && (v[0] === "'" || v[0] === '"') && v[v.length - 1] === v[0];

export function unquote(v: string): string {
  const inner = v.slice(1, -1);
  return v[0] === '"' ? inner.replace(/\\(["\\])/g, "$1") : inner;
}

/** Single quotes are literal in NSS (handy for Windows paths); fall back to double quotes. */
export function quote(text: string, prefer: "'" | '"' = "'"): string {
  if (prefer === "'" && !text.includes("'")) return `'${text}'`;
  if (!text.includes('"')) return `"${text}"`;
  return `'${text}'`;
}

export const getProp = (props: Prop[], ...names: string[]) =>
  props.find((p) => names.includes(p.name.toLowerCase()));

/** Human label for a value: unquoted text for strings, the expression otherwise. */
export function displayValue(v: string | null | undefined): string {
  if (v == null) return "";
  return isQuoted(v) ? unquote(v) : v;
}

export function nodeTitle(n: NssNode): string {
  if (n.kind === "item" || n.kind === "menu") {
    const t = getProp(n.props, "title");
    return t ? displayValue(t.value).replace(/&(?!&)/g, "") : n.kind === "menu" ? "(untitled menu)" : "(untitled item)";
  }
  if (n.kind === "separator") return "Separator";
  const firstLine = n.text.split("\n")[0].trim();
  return firstLine.length > 70 ? firstLine.slice(0, 67) + "..." : firstLine;
}

/** The import target of a raw `import 'imports/x.nss'` statement, if it is one. */
export function importTarget(n: NssNode): string | null {
  if (n.kind !== "raw") return null;
  const m = /^import\s+(?:\w+\s+)?(['"])(.+?)\1/.exec(n.text.trim());
  return m ? m[2] : null;
}

// ------------------------------------------------------------------ edits
// All edits operate on a structuredClone'd document (see useNssDocument).

export function findParent(
  doc: NssDocument,
  id: number,
): { list: NssNode[]; index: number; parent: MenuNode | null } | null {
  const walk = (list: NssNode[], parent: MenuNode | null): ReturnType<typeof findParent> => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.id === id) return { list, index: i, parent };
      if (n.kind === "menu") {
        const r = walk(n.children, n);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(doc.nodes, null);
}

export function findNode(doc: NssDocument, id: number): NssNode | null {
  const r = findParent(doc, id);
  return r ? r.list[r.index] : null;
}

function indentOf(lead: string): string {
  const lastLine = lead.slice(lead.lastIndexOf("\n") + 1);
  return /^[ \t]*/.exec(lastLine)![0];
}

/** Indentation used for children of `parent` (or top level). */
function childIndent(doc: NssDocument, parent: MenuNode | null): string {
  const siblings = parent ? parent.children : doc.nodes;
  if (siblings.length) return indentOf(siblings[siblings.length - 1].lead);
  if (!parent) return "";
  const parentLoc = findParent(doc, parent.id);
  const parentIndent = parentLoc ? indentOf(parentLoc.list[parentLoc.index].lead) : "";
  return parentIndent + "\t";
}

export function makeItem(props: Prop[]): ItemNode {
  return { kind: "item", id: newId(), lead: "", props, text: "", dirty: true };
}

export function makeMenu(props: Prop[], indent: string): MenuNode {
  return {
    kind: "menu",
    id: newId(),
    lead: "",
    props,
    header: "",
    open: `\n${indent}{`,
    children: [],
    tail: `\n${indent}`,
    close: "}",
    dirty: true,
  };
}

export function makeSeparator(): SeparatorNode {
  return { kind: "separator", id: newId(), lead: "", text: "separator" };
}

/**
 * Inserts after `afterId` (same parent), or as the last child of menu `intoId`,
 * or at the end of the document.
 */
export function insertNode(
  doc: NssDocument,
  node: NssNode,
  where: { afterId?: number; intoId?: number },
): void {
  let list = doc.nodes;
  let index = list.length;
  let parent: MenuNode | null = null;
  if (where.afterId != null) {
    const loc = findParent(doc, where.afterId);
    if (loc) {
      ({ list, parent } = loc);
      index = loc.index + 1;
    }
  } else if (where.intoId != null) {
    const target = findNode(doc, where.intoId);
    if (target?.kind === "menu") {
      parent = target;
      list = target.children;
      index = list.length;
    }
  }
  const indent = childIndent(doc, parent);
  node.lead = `\n${indent}`;
  if (node.kind === "menu") {
    node.open = `\n${indent}{`;
    node.tail = `\n${indent}`;
  }
  if (parent && !parent.children.length && !parent.tail.includes("\n")) {
    parent.tail = `\n${indent.slice(0, -1)}`;
  }
  list.splice(index, 0, node);
}

export function removeNode(doc: NssDocument, id: number): void {
  const loc = findParent(doc, id);
  if (loc) loc.list.splice(loc.index, 1);
}

/** Swaps with the previous/next sibling. Leads stay with their position so formatting holds. */
export function moveNode(doc: NssDocument, id: number, delta: -1 | 1): boolean {
  const loc = findParent(doc, id);
  if (!loc) return false;
  const j = loc.index + delta;
  if (j < 0 || j >= loc.list.length) return false;
  const a = loc.list[loc.index];
  const b = loc.list[j];
  [a.lead, b.lead] = [b.lead, a.lead];
  loc.list[loc.index] = b;
  loc.list[j] = a;
  return true;
}

export function setProps(doc: NssDocument, id: number, props: Prop[]): void {
  const n = findNode(doc, id);
  if (n && (n.kind === "item" || n.kind === "menu")) {
    n.props = props;
    n.dirty = true;
  }
}

/** Replaces a raw node's text. Re-parses so an edited raw block can become an item/menu. */
export function setRawText(doc: NssDocument, id: number, text: string): void {
  const loc = findParent(doc, id);
  if (!loc) return;
  const old = loc.list[loc.index];
  const reparsed = parse(text);
  const only = reparsed.nodes[0];
  if (reparsed.nodes.length === 1 && !reparsed.tail.trim() && !only.lead.trim()) {
    only.lead = old.lead;
    only.id = old.id;
    loc.list[loc.index] = only;
    return;
  }
  loc.list[loc.index] = { kind: "raw", id: old.id, lead: old.lead, text };
}

export function countNodes(nodes: NssNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + (n.kind === "menu" ? countNodes(n.children) : 0), 0);
}
