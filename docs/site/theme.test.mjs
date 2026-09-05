import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const css = await readFile(new URL("./.vitepress/theme/custom.css", import.meta.url), "utf8");

describe("documentation theme", () => {
  it("lets general prose use the full content width", () => {
    assert.doesNotMatch(css, /\.docs-home \.vp-doc p,\s*\.docs-home \.vp-doc li\s*\{\s*max-width:/s);
    assert.doesNotMatch(css, /\.VPDoc\.has-aside \.vp-doc > :where\(p, ul, ol, blockquote\)\s*\{\s*max-width:/s);
  });

  it("does not cap homepage copy with character-based widths", () => {
    assert.doesNotMatch(css, /\.docs-home \.vp-doc h1 \+ p\s*\{[^}]*max-width:/s);
    assert.doesNotMatch(css, /\.docs-home \.vp-doc h1 \+ p \+ p\s*\{[^}]*max-width:/s);
    assert.doesNotMatch(css, /\.docs-home \.vp-doc p:has\(> #agent-install\) \+ h3 \+ p\s*\{[^}]*max-width:/s);
  });

  it("overrides the scoped VitePress width and contains nested mobile code blocks", () => {
    assert.match(css, /\.VPDoc\.has-aside \.content > \.content-container\s*\{\s*max-width: 880px;/s);
    assert.match(
      css,
      /@media \(max-width: 639px\)[^{]*\{[^}]*details\.full-check div\[class\*="language-"\][^{]*\{[^}]*margin-inline: -20px;/s,
    );
  });

  it("keeps touch copy buttons visible without covering code or language labels", () => {
    const touchStyles = css.match(/@media \(hover: none\) \{([\s\S]*?)\n\}/)?.[1];
    assert.ok(touchStyles, "touch-only copy affordances must not change desktop hover behavior");
    assert.match(touchStyles, /\.docs-home div\[class\*="language-"\] > button\.copy\s*\{[^}]*opacity: 1;/s);
    assert.match(
      touchStyles,
      /\.docs-home div\[class\*="language-"\] > button\.copy \+ span\.lang\s*\{[^}]*opacity: 0;/s,
    );
    assert.match(touchStyles, /\.docs-home div\[class\*="language-"\] > pre\s*\{[^}]*padding-top: 64px;/s);
  });
});
