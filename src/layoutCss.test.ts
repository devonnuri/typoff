/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

// Collapse whitespace so multi-line selectors like "html,\nbody {" match.
const indexCss = readFileSync(resolve(root, "src/index.css"), "utf8").replace(
  /\s+/g,
  " ",
);
const appCss = readFileSync(resolve(root, "src/App.css"), "utf8").replace(
  /\s+/g,
  " ",
);

/** Extract a top-level CSS block like `html, body { ... }` by its selector text. */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  const bodyEnd = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

describe("layout CSS: no page scroll, dvh-locked height", () => {
  it("locks document scrolling with overflow hidden on html and body", () => {
    const block = cssBlock(indexCss, "html, body");
    expect(block).toContain("overflow: hidden");
  });

  it("zeroes out page margins and padding on html/body", () => {
    const block = cssBlock(indexCss, "html, body");
    expect(block).toContain("margin: 0");
    expect(block).toContain("padding: 0");
  });

  it("prevents horizontal overflow on html/body", () => {
    const block = cssBlock(indexCss, "html, body");
    expect(block).toContain("overflow-x: hidden");
  });

  it("#root is dvh-locked with vh fallback and overflow hidden", () => {
    const block = cssBlock(indexCss, "#root");
    expect(block).toContain("100dvh");
    // fallback line first, then the dvh line
    const vhIdx = block.indexOf("height: 100vh");
    const dvhIdx = block.indexOf("height: 100dvh");
    expect(vhIdx).toBeGreaterThanOrEqual(0);
    expect(dvhIdx).toBeGreaterThan(vhIdx);
    expect(block).toContain("overflow: hidden");
  });

  it(".app is dvh-locked with vh fallback and overflow hidden", () => {
    const block = cssBlock(appCss, ".app");
    expect(block).toContain("100dvh");
    const vhIdx = block.indexOf("height: 100vh");
    const dvhIdx = block.indexOf("height: 100dvh");
    expect(vhIdx).toBeGreaterThanOrEqual(0);
    expect(dvhIdx).toBeGreaterThan(vhIdx);
    expect(block).toContain("max-height: 100dvh");
    expect(block).toContain("overflow: hidden");
  });

  it("body no longer uses fixed viewport sizing", () => {
    const bodyBlock = cssBlock(indexCss, "body {");
    expect(bodyBlock).not.toContain("100vh");
    expect(bodyBlock).not.toContain("100dvh");
  });
});
