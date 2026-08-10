import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { applyThemeAccessibility, installThemeAccessibility } from "./.vitepress/theme/accessibility.js";

const originalGlobals = {
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  document: globalThis.document,
  MutationObserver: globalThis.MutationObserver,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  window: globalThis.window,
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete globalThis[name];
    } else {
      globalThis[name] = value;
    }
  }
});

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (name) => values.add(name),
    contains: (name) => values.has(name),
    remove: (name) => values.delete(name),
  };
}

function createElement({ attributes = {}, classes = [], textContent = "" } = {}) {
  const attributeMap = new Map(Object.entries(attributes));
  return {
    childNodes: [],
    classList: createClassList(classes),
    className: classes.join(" "),
    id: "",
    ownerDocument: undefined,
    parentElement: undefined,
    textContent,
    title: "",
    closest: () => undefined,
    getAttribute: (name) => attributeMap.get(name),
    removeAttribute: (name) => attributeMap.delete(name),
    setAttribute: (name, value) => attributeMap.set(name, String(value)),
  };
}

function createAccessibilityDocument(language) {
  const mainNavigation = createElement();
  const sidebarNavigation = createElement();
  const pager = createElement();
  const mobileNavigation = createElement({ attributes: { "aria-expanded": "false" } });
  const extraNavigation = createElement();
  const appearance = createElement({ attributes: { "aria-checked": "false" } });
  const copy = createElement({ classes: ["copy"] });
  const heading = createElement();
  const headingText = { textContent: language.startsWith("zh") ? "安装" : "Install" };
  const anchor = createElement();
  heading.childNodes = [headingText, anchor];
  anchor.closest = () => heading;

  const singleSelectors = new Map([
    ["#main-nav-aria-label", mainNavigation],
    ["#sidebar-aria-label", sidebarNavigation],
    ["#doc-footer-aria-label", pager],
    [".VPNavBarHamburger", mobileNavigation],
    [".VPNavBarExtra > button", extraNavigation],
  ]);
  const multipleSelectors = new Map([
    [".VPSidebarItem .caret", []],
    [".VPSwitchAppearance", [appearance]],
    ["button.copy", [copy]],
    [".header-anchor", [anchor]],
  ]);
  const appended = [];
  const document = {
    body: {
      append(element) {
        element.ownerDocument = document;
        appended.push(element);
      },
    },
    documentElement: { lang: language },
    readyState: "complete",
    createElement: () => createElement(),
    getElementById: (id) => appended.find((element) => element.id === id),
    querySelector: (selector) => singleSelectors.get(selector),
    querySelectorAll: (selector) => multipleSelectors.get(selector) ?? [],
  };

  for (const element of [
    mainNavigation,
    sidebarNavigation,
    pager,
    mobileNavigation,
    extraNavigation,
    appearance,
    copy,
    heading,
    anchor,
  ]) {
    element.ownerDocument = document;
  }

  return {
    anchor,
    appearance,
    copy,
    document,
    mainNavigation,
    mobileNavigation,
  };
}

function installAnimationFrame() {
  let frame = 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    frame += 1;
    return frame;
  };
}

describe("theme accessibility integration", () => {
  it("localizes controls and announces a copied-state transition", () => {
    installAnimationFrame();
    const chinese = createAccessibilityDocument("zh-CN");

    applyThemeAccessibility(chinese.document);
    assert.equal(chinese.mainNavigation.textContent, "主导航");
    assert.equal(chinese.mobileNavigation.getAttribute("aria-label"), "打开移动导航");
    assert.equal(chinese.copy.getAttribute("aria-label"), "复制代码");
    assert.equal(chinese.anchor.getAttribute("aria-label"), "“安装”的永久链接");

    chinese.copy.classList.add("copied");
    applyThemeAccessibility(chinese.document);
    assert.equal(chinese.copy.getAttribute("aria-label"), "代码已复制");
    assert.equal(chinese.document.getElementById("docs-copy-status").textContent, "代码已复制");

    const english = createAccessibilityDocument("en-US");
    applyThemeAccessibility(english.document);
    assert.equal(english.mainNavigation.textContent, "Main navigation");
    assert.equal(english.copy.getAttribute("aria-label"), "Copy code");
    assert.equal(english.anchor.getAttribute("aria-label"), 'Permalink to "Install"');
  });

  it("reapplies localized labels after route and mutation changes", async () => {
    installAnimationFrame();
    const fixture = createAccessibilityDocument("en-US");
    let mutationCallback;
    globalThis.document = fixture.document;
    globalThis.window = {};
    globalThis.MutationObserver = class {
      constructor(callback) {
        mutationCallback = callback;
      }

      observe() {}
    };
    const router = {};

    installThemeAccessibility(router);
    assert.equal(fixture.mainNavigation.textContent, "Main navigation");

    fixture.document.documentElement.lang = "zh-CN";
    await router.onAfterRouteChanged();
    assert.equal(fixture.mainNavigation.textContent, "主导航");

    fixture.document.documentElement.lang = "en-US";
    mutationCallback();
    assert.equal(fixture.mainNavigation.textContent, "Main navigation");
  });
});
