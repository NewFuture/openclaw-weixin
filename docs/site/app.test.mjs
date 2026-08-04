import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setupSearch, setupSidebar, setupTheme } from "./app.js";

class FakeClassList {
  values = new Set();

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
    return force;
  }
}

function createElement() {
  const element = new EventTarget();
  const attributes = new Map();
  element.attributes = attributes;
  element.classList = new FakeClassList();
  element.children = [];
  element.dataset = {};
  element.hidden = false;
  element.value = "";
  element.append = (...children) => element.children.push(...children);
  element.replaceChildren = () => {
    element.children = [];
  };
  element.contains = (candidate) => element.children.includes(candidate);
  element.setAttribute = (name, value) => attributes.set(name, String(value));
  element.getAttribute = (name) => attributes.get(name) ?? null;
  element.removeAttribute = (name) => attributes.delete(name);
  element.toggleAttribute = (name, force) => {
    if (force) attributes.set(name, "");
    else attributes.delete(name);
    return force;
  };
  element.click = () => element.dispatchEvent(new Event("click"));
  return element;
}

function createThemeFixture(stored = null) {
  const root = new EventTarget();
  const button = createElement();
  const store = new Map(stored === null ? [] : [["openclaw-weixin:theme", stored]]);
  root.documentElement = { dataset: {} };
  root.querySelector = (selector) => (selector === "[data-theme-toggle]" ? button : null);
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  return { root, button, store, storage };
}

function createSearchFixture() {
  const root = new EventTarget();
  const input = createElement();
  const results = createElement();
  input.tagName = "INPUT";
  results.hidden = true;
  results.dataset.empty = "No results";
  root.activeElement = null;
  root.documentElement = { dataset: { siteLang: "en" } };
  root.querySelector = (selector) =>
    new Map([
      ["[data-search]", input],
      ["[data-search-results]", results],
    ]).get(selector) ?? null;
  root.createElement = () => createElement();
  root.createTextNode = (text) => ({ textContent: text });
  input.focus = () => {
    root.activeElement = input;
  };
  return { root, input, results };
}

function keyEvent(key) {
  const event = new Event("keydown");
  Object.defineProperty(event, "key", { value: key });
  return event;
}

async function nextTask() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createFixture(matches = true) {
  const root = new EventTarget();
  const toggle = createElement();
  const sidebar = createElement();
  const scrim = createElement();
  const sidebarLink = createElement();
  const mobileViewport = new EventTarget();
  mobileViewport.matches = matches;
  root.activeElement = null;
  root.querySelector = (selector) =>
    new Map([
      ["[data-menu-toggle]", toggle],
      ["[data-sidebar]", sidebar],
      ["[data-sidebar-scrim]", scrim],
    ]).get(selector) ?? null;
  toggle.focus = () => {
    root.activeElement = toggle;
  };
  sidebar.contains = (element) => element === sidebarLink;
  return { root, toggle, sidebar, scrim, sidebarLink, mobileViewport };
}

describe("setupSidebar", () => {
  it("removes a closed mobile drawer from focus and restores focus when it closes", () => {
    const fixture = createFixture();
    setupSidebar(fixture.root, fixture.mobileViewport);

    assert.equal(fixture.sidebar.attributes.has("inert"), true);
    assert.equal(fixture.sidebar.getAttribute("aria-hidden"), "true");
    assert.equal(fixture.toggle.getAttribute("aria-expanded"), "false");
    assert.equal(fixture.scrim.hidden, true);

    fixture.toggle.dispatchEvent(new Event("click"));
    assert.equal(fixture.sidebar.classList.contains("is-open"), true);
    assert.equal(fixture.sidebar.attributes.has("inert"), false);
    assert.equal(fixture.sidebar.getAttribute("aria-hidden"), null);
    assert.equal(fixture.toggle.getAttribute("aria-expanded"), "true");
    assert.equal(fixture.scrim.hidden, false);

    fixture.root.activeElement = fixture.sidebarLink;
    fixture.toggle.dispatchEvent(new Event("click"));
    assert.equal(fixture.root.activeElement, fixture.toggle);
    assert.equal(fixture.sidebar.attributes.has("inert"), true);
  });

  it("keeps desktop navigation visible and focusable after a viewport change", () => {
    const fixture = createFixture();
    setupSidebar(fixture.root, fixture.mobileViewport);
    fixture.root.activeElement = fixture.sidebarLink;
    fixture.mobileViewport.matches = false;
    fixture.mobileViewport.dispatchEvent(new Event("change"));

    assert.equal(fixture.sidebar.classList.contains("is-open"), false);
    assert.equal(fixture.sidebar.attributes.has("inert"), false);
    assert.equal(fixture.sidebar.getAttribute("aria-hidden"), null);
    assert.equal(fixture.root.activeElement, fixture.sidebarLink);
  });
});

describe("setupSearch", () => {
  const dismissals = {
    "the query is cleared": ({ input }) => {
      input.value = "";
      input.dispatchEvent(new Event("input"));
    },
    "Escape is pressed": ({ root }) => root.dispatchEvent(keyEvent("Escape")),
    "the user clicks outside": ({ root }) => root.dispatchEvent(new Event("click")),
  };

  for (const [scenario, dismiss] of Object.entries(dismissals)) {
    it(`does not restore stale results after ${scenario}`, async () => {
      const fixture = createSearchFixture();
      let resolveResponse;
      const response = new Promise((resolve) => {
        resolveResponse = resolve;
      });
      setupSearch(fixture.root, () => response);
      fixture.input.value = "guide";
      fixture.input.dispatchEvent(new Event("input"));
      dismiss(fixture);
      resolveResponse({
        json: async () => ({
          entries: [{ t: "Guide", p: "Documentation", s: "", u: "guide.html" }],
        }),
      });
      await nextTask();

      assert.equal(fixture.results.hidden, true);
      assert.equal(fixture.results.children.length, 0);
      assert.equal(fixture.input.getAttribute("aria-expanded"), "false");
      assert.equal(fixture.input.getAttribute("aria-activedescendant"), null);
    });
  }

  const entries = [
    { t: "Guide", p: "Documentation", s: "", u: "guide.html" },
    { t: "Guide details", p: "Documentation", s: "", u: "guide.html#details" },
    { t: "Guide FAQ", p: "Documentation", s: "", u: "guide.html#faq" },
  ];

  async function openResults(fixture, query = "guide") {
    setupSearch(fixture.root, async () => ({ json: async () => ({ entries }) }));
    fixture.input.value = query;
    fixture.input.dispatchEvent(new Event("input"));
    await nextTask();
    return fixture.results.children;
  }

  it("walks the options with the arrow keys and reports the active one", async () => {
    const fixture = createSearchFixture();
    const [first, second, last] = await openResults(fixture);

    assert.equal(fixture.results.hidden, false);
    assert.equal(fixture.input.getAttribute("aria-expanded"), "true");
    assert.equal(fixture.input.getAttribute("aria-activedescendant"), null);
    assert.deepEqual(
      [first, second, last].map((option) => option.getAttribute("role")),
      ["option", "option", "option"],
    );

    fixture.input.dispatchEvent(keyEvent("ArrowDown"));
    assert.equal(fixture.input.getAttribute("aria-activedescendant"), first.id);
    assert.equal(first.getAttribute("aria-selected"), "true");
    assert.equal(first.classList.contains("is-active"), true);

    fixture.input.dispatchEvent(keyEvent("ArrowDown"));
    assert.equal(fixture.input.getAttribute("aria-activedescendant"), second.id);
    assert.equal(first.getAttribute("aria-selected"), "false");
    assert.equal(first.classList.contains("is-active"), false);

    fixture.input.dispatchEvent(keyEvent("ArrowUp"));
    fixture.input.dispatchEvent(keyEvent("ArrowUp"));
    assert.equal(fixture.input.getAttribute("aria-activedescendant"), last.id);
  });

  it("opens the active option with Enter and collapses on Escape", async () => {
    const fixture = createSearchFixture();
    const [first] = await openResults(fixture);
    let opened = 0;
    first.addEventListener("click", () => {
      opened += 1;
    });

    fixture.input.dispatchEvent(keyEvent("Enter"));
    assert.equal(opened, 0, "Enter without an active option keeps the native form behavior");

    fixture.input.dispatchEvent(keyEvent("ArrowDown"));
    fixture.input.dispatchEvent(keyEvent("Enter"));
    assert.equal(opened, 1);

    fixture.root.dispatchEvent(keyEvent("Escape"));
    assert.equal(fixture.results.hidden, true);
    assert.equal(fixture.input.getAttribute("aria-expanded"), "false");
    assert.equal(fixture.input.getAttribute("aria-activedescendant"), null);
  });

  it("announces an empty result set without offering it as a choice", async () => {
    const fixture = createSearchFixture();
    const children = await openResults(fixture, "nothing-matches-this");

    assert.equal(children.length, 1);
    assert.equal(children[0].textContent, "No results");
    assert.equal(children[0].getAttribute("role"), "option");
    assert.equal(children[0].getAttribute("aria-disabled"), "true");

    fixture.input.dispatchEvent(keyEvent("ArrowDown"));
    assert.equal(fixture.input.getAttribute("aria-activedescendant"), null);
  });
});

describe("setupTheme", () => {
  it("ignores a persisted value that is not a known theme", () => {
    const fixture = createThemeFixture("sepia");
    setupTheme(fixture.root, fixture.storage);

    assert.equal(fixture.root.documentElement.dataset.theme, undefined);
    assert.equal(fixture.button.dataset.theme, "auto");
  });

  it("restores a persisted theme", () => {
    const fixture = createThemeFixture("dark");
    setupTheme(fixture.root, fixture.storage);

    assert.equal(fixture.root.documentElement.dataset.theme, "dark");
    assert.equal(fixture.button.dataset.theme, "dark");
  });

  it("cycles auto to light to dark and persists every step", () => {
    const fixture = createThemeFixture();
    setupTheme(fixture.root, fixture.storage);

    fixture.button.dispatchEvent(new Event("click"));
    assert.equal(fixture.root.documentElement.dataset.theme, "light");
    assert.equal(fixture.store.get("openclaw-weixin:theme"), "light");

    fixture.button.dispatchEvent(new Event("click"));
    assert.equal(fixture.root.documentElement.dataset.theme, "dark");
    assert.equal(fixture.store.get("openclaw-weixin:theme"), "dark");

    fixture.button.dispatchEvent(new Event("click"));
    assert.equal(fixture.root.documentElement.dataset.theme, undefined);
    assert.equal(fixture.store.has("openclaw-weixin:theme"), false);
  });

  it("keeps switching themes when storage is unavailable", () => {
    const fixture = createThemeFixture();
    const blocked = () => {
      throw new Error("storage is blocked");
    };
    setupTheme(fixture.root, { getItem: blocked, setItem: blocked, removeItem: blocked });

    assert.equal(fixture.button.dataset.theme, "auto");
    fixture.button.dispatchEvent(new Event("click"));
    assert.equal(fixture.root.documentElement.dataset.theme, "light");
  });
});
