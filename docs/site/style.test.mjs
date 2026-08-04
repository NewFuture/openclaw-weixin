import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const css = await readFile(join(SITE_DIR, "style.css"), "utf8");

function declarations(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} should exist`);
  const bodyStart = css.indexOf("{", start) + 1;
  const body = css.slice(bodyStart, css.indexOf("}", bodyStart));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1], match[2]]));
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left, right) {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("site palette", () => {
  const base = declarations(":root");
  const themes = {
    light: { ...base, ...declarations(':root[data-theme="light"]') },
    dark: { ...base, ...declarations(':root[data-theme="dark"]') },
  };

  it("keeps Weixin green as the lead color", () => {
    assert.equal(base["--brand"], "#07c160");
  });

  for (const [name, palette] of Object.entries(themes)) {
    it(`${name} theme keeps text and controls at accessible contrast`, () => {
      assert.ok(contrast(palette["--brand-strong"], palette["--bg"]) >= 4.5);
      assert.ok(contrast(palette["--claw"], palette["--bg"]) >= 4.5);
      assert.ok(contrast(palette["--brand-fill"], palette["--on-brand"]) >= 4.5);
      assert.ok(contrast(palette["--brand-fill-hover"], palette["--on-brand"]) >= 4.5);
      assert.ok(contrast(palette["--brand-fill"], palette["--bg"]) >= 3);
      assert.ok(contrast(palette["--brand-fill-hover"], palette["--bg"]) >= 3);
    });
  }

  it("visually hides the closed mobile drawer", () => {
    const start = css.indexOf("@media (width <= 880px)");
    const end = css.indexOf("@media (prefers-reduced-motion", start);
    const responsive = css.slice(start, end);
    assert.match(responsive, /\.sidebar\s*\{[^}]*visibility:\s*hidden;/s);
    assert.match(responsive, /\.sidebar\.is-open\s*\{[^}]*visibility:\s*visible;/s);
  });
});
