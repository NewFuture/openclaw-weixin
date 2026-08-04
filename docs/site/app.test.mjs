import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { setupSearch, setupSidebar } from "./app.js";

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
  return element;
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
    });
  }
});
