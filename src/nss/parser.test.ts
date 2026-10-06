import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countNodes,
  findNode,
  getProp,
  importTarget,
  insertNode,
  makeItem,
  makeMenu,
  makeSeparator,
  moveNode,
  nodeTitle,
  parse,
  parseProps,
  quote,
  removeNode,
  serialize,
  setProps,
  type MenuNode,
} from "./parser";

const fixtures = join(__dirname, "fixtures");
const files = readdirSync(fixtures).filter((f) => f.endsWith(".nss"));

describe("round trip", () => {
  it.each(files)("%s serializes back unchanged", (name) => {
    const src = readFileSync(join(fixtures, name), "utf8");
    expect(serialize(parse(src))).toBe(src);
  });

  it("keeps comments, settings blocks and odd spacing", () => {
    const src = "// top\nsettings\n{\n\tpriority=1\n}\n\n/* block */ item( title = 'a'  cmd='b' )\r\n";
    expect(serialize(parse(src))).toBe(src);
  });
});

describe("structure", () => {
  it("parses the terminal menu with items", () => {
    const doc = parse(readFileSync(join(fixtures, "terminal.nss"), "utf8"));
    const menu = doc.nodes[0] as MenuNode;
    expect(menu.kind).toBe("menu");
    expect(getProp(menu.props, "title")?.value).toBe("title.terminal");
    expect(getProp(menu.props, "where")?.value).toBe("(sel.count or wnd.is_taskbar or wnd.is_edit)");
    const kinds = menu.children.map((c) => c.kind);
    expect(kinds).toEqual(["raw", "raw", "item", "item", "item"]);
    const wt = menu.children[4];
    expect(wt.kind === "item" && getProp(wt.props, "image")?.value).toBe(
      `'@package.path("WindowsTerminal")\\WindowsTerminal.exe'`,
    );
  });

  it("parses nested menus and separators in develop.nss", () => {
    const doc = parse(readFileSync(join(fixtures, "develop.nss"), "utf8"));
    expect(countNodes(doc.nodes)).toBeGreaterThan(20);
    const develop = doc.nodes[0] as MenuNode;
    expect(nodeTitle(develop)).toBe("Develop");
    expect(develop.children[0].kind).toBe("menu");
    expect((develop.children[0] as MenuNode).children[1].kind).toBe("separator");
  });

  it("treats modify/remove/import as raw", () => {
    const doc = parse(readFileSync(join(fixtures, "shell.nss"), "utf8"));
    const imports = doc.nodes.map(importTarget).filter(Boolean);
    expect(imports).toContain("imports/terminal.nss");
    expect(doc.nodes.filter((n) => n.kind === "raw" && n.text.startsWith("remove")).length).toBe(4);
  });

  it("parses flags and expressions in props", () => {
    expect(parseProps("title=title.x image sep='top' where=a==b || c.d(1) admin=key.shift() or key.rbutton()")).toEqual([
      { name: "title", value: "title.x" },
      { name: "image", value: null },
      { name: "sep", value: "'top'" },
      { name: "where", value: "a==b || c.d(1)" },
      { name: "admin", value: "key.shift() or key.rbutton()" },
    ]);
    expect(parseProps("image=[\\uE272, #22A7F2] cmd-line='/K x'")).toEqual([
      { name: "image", value: "[\\uE272, #22A7F2]" },
      { name: "cmd-line", value: "'/K x'" },
    ]);
  });
});

describe("edits", () => {
  const src = "menu(title='A')\n{\n\titem(title='one')\n\titem(title='two')\n}\nitem(title='top')\n";

  it("edits only the touched node", () => {
    const doc = parse(src);
    const menu = doc.nodes[0] as MenuNode;
    const one = menu.children[0];
    setProps(doc, one.id, [{ name: "title", value: quote("uno") }, { name: "cmd", value: quote("x.exe") }]);
    expect(serialize(doc)).toBe(src.replace("item(title='one')", "item(title='uno' cmd='x.exe')"));
  });

  it("inserts with matching indentation", () => {
    const doc = parse(src);
    const menu = doc.nodes[0] as MenuNode;
    insertNode(doc, makeItem([{ name: "title", value: "'three'" }]), { intoId: menu.id });
    insertNode(doc, makeSeparator(), { afterId: menu.children[0].id });
    expect(serialize(doc)).toBe(
      "menu(title='A')\n{\n\titem(title='one')\n\tseparator\n\titem(title='two')\n\titem(title='three')\n}\nitem(title='top')\n",
    );
  });

  it("creates a new menu at top level and nests into it", () => {
    const doc = parse(src);
    const m = makeMenu([{ name: "title", value: "'Claude'" }], "");
    insertNode(doc, m, {});
    insertNode(doc, makeItem([{ name: "title", value: "'Open'" }]), { intoId: m.id });
    expect(serialize(doc)).toBe(src.trimEnd() + "\nmenu(title='Claude')\n{\n\titem(title='Open')\n}\n");
  });

  it("moves and removes", () => {
    const doc = parse(src);
    const menu = doc.nodes[0] as MenuNode;
    const two = menu.children[1].id;
    expect(moveNode(doc, two, -1)).toBe(true);
    expect(serialize(doc)).toBe(src.replace("item(title='one')\n\titem(title='two')", "item(title='two')\n\titem(title='one')"));
    removeNode(doc, two);
    expect(findNode(doc, two)).toBeNull();
    expect(serialize(doc)).toBe("menu(title='A')\n{\n\titem(title='one')\n}\nitem(title='top')\n");
  });
});
