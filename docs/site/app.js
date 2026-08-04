/**
 * Progressive enhancements for the documentation site: theme switching, the
 * mobile navigation drawer, table-of-contents highlighting, code copying, and
 * client-side search over the generated index.
 *
 * Every feature degrades gracefully: the pages remain readable without
 * JavaScript and never load third-party resources.
 */

const THEME_KEY = "openclaw-weixin:theme";
const LANGUAGE_KEY = "openclaw-weixin:lang";
const THEME_ORDER = ["auto", "light", "dark"];

function resolveStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    /* Storage access can throw when cookies are blocked; the theme falls back to system. */
    return null;
  }
}

function readStorage(key, storage) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key, value, storage) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* Storage can be unavailable in private modes; theme falls back to system. */
  }
}

export function setupTheme(root = document, storage = resolveStorage()) {
  const button = root.querySelector("[data-theme-toggle]");
  if (!button) return;
  const apply = (theme) => {
    if (theme === "auto") delete root.documentElement.dataset.theme;
    else root.documentElement.dataset.theme = theme;
    button.dataset.theme = theme;
  };
  const stored = readStorage(THEME_KEY, storage);
  apply(THEME_ORDER.includes(stored) ? stored : "auto");
  button.addEventListener("click", () => {
    const current = button.dataset.theme || "auto";
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    apply(next);
    writeStorage(THEME_KEY, next === "auto" ? null : next, storage);
  });
}

function setupLanguageMemory(root = document, storage = resolveStorage()) {
  for (const link of root.querySelectorAll("[data-lang]")) {
    link.addEventListener("click", () => {
      writeStorage(LANGUAGE_KEY, link.dataset.lang, storage);
    });
  }
}

export function setupSidebar(root = document, mobileViewport = window.matchMedia("(max-width: 880px)")) {
  const toggle = root.querySelector("[data-menu-toggle]");
  const sidebar = root.querySelector("[data-sidebar]");
  const scrim = root.querySelector("[data-sidebar-scrim]");
  if (!toggle || !sidebar) return;
  const setOpen = (open) => {
    const nextOpen = Boolean(open && mobileViewport.matches);
    if (mobileViewport.matches && !nextOpen && sidebar.contains(root.activeElement)) toggle.focus();
    sidebar.classList.toggle("is-open", nextOpen);
    sidebar.toggleAttribute("inert", mobileViewport.matches && !nextOpen);
    if (mobileViewport.matches && !nextOpen) sidebar.setAttribute("aria-hidden", "true");
    else sidebar.removeAttribute("aria-hidden");
    toggle.setAttribute("aria-expanded", String(nextOpen));
    if (scrim) scrim.hidden = !nextOpen;
  };
  toggle.addEventListener("click", () => setOpen(!sidebar.classList.contains("is-open")));
  scrim?.addEventListener("click", () => setOpen(false));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  const handleViewportChange = () => setOpen(false);
  if (mobileViewport.addEventListener) mobileViewport.addEventListener("change", handleViewportChange);
  else mobileViewport.addListener?.(handleViewportChange);
  setOpen(false);
}

function setupCopyButtons() {
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block")?.querySelector("code");
      if (!code || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(code.textContent ?? "");
        button.textContent = button.dataset.copiedLabel ?? "Copied";
        setTimeout(() => {
          button.textContent = button.dataset.copyLabel ?? "Copy";
        }, 1600);
      } catch {
        /* Clipboard permission denied; the code stays selectable. */
      }
    });
  }
}

function setupTableOfContents() {
  const links = [...document.querySelectorAll(".toc a")];
  if (links.length === 0 || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map((link) => [decodeURIComponent(link.hash.slice(1)), link]));
  const headings = [...document.querySelectorAll(".markdown h2[id], .markdown h3[id]")].filter((heading) =>
    byId.has(heading.id),
  );
  if (headings.length === 0) return;
  const visible = new Set();
  const highlight = () => {
    const active = headings.find((heading) => visible.has(heading.id)) ?? null;
    for (const link of links) link.classList.remove("is-active");
    if (active) byId.get(active.id)?.classList.add("is-active");
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      highlight();
    },
    { rootMargin: "-72px 0px -70% 0px", threshold: 0 },
  );
  for (const heading of headings) observer.observe(heading);
}

function scoreEntry(entry, query) {
  const title = entry.t.toLowerCase();
  const page = entry.p.toLowerCase();
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (page.includes(query)) return 30;
  if ((entry.s ?? "").toLowerCase().includes(query)) return 20;
  return 0;
}

export function setupSearch(root = document, request = fetch) {
  const input = root.querySelector("[data-search]");
  const results = root.querySelector("[data-search-results]");
  if (!input || !results) return;
  const language = root.documentElement.dataset.siteLang || "en";
  let entries = null;
  let searchVersion = 0;
  let options = [];
  let activeIndex = -1;

  /** Keep the combobox state (`aria-activedescendant`) and the visible highlight in sync. */
  const setActive = (index) => {
    activeIndex = index >= 0 && index < options.length ? index : -1;
    for (const [position, option] of options.entries()) {
      const active = position === activeIndex;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
    }
    const active = options[activeIndex];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView?.({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const collapse = () => {
    results.hidden = true;
    options = [];
    setActive(-1);
    input.setAttribute("aria-expanded", "false");
  };

  const move = (delta) => {
    if (options.length === 0) return;
    const first = delta > 0 ? 0 : options.length - 1;
    setActive(activeIndex < 0 ? first : (activeIndex + delta + options.length) % options.length);
  };

  const render = (matches) => {
    results.replaceChildren();
    options = [];
    if (matches.length === 0) {
      const empty = root.createElement("p");
      empty.className = "search-empty";
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      empty.textContent = results.dataset.empty ?? "";
      results.append(empty);
    }
    for (const [index, entry] of matches.entries()) {
      const link = root.createElement("a");
      link.href = `./${entry.u}`;
      link.id = `search-result-${index}`;
      link.setAttribute("role", "option");
      const page = root.createElement("span");
      page.className = "result-page";
      page.textContent = entry.p;
      link.append(root.createTextNode(entry.t), page);
      results.append(link);
      options.push(link);
    }
    setActive(-1);
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const load = async () => {
    if (entries) return entries;
    const response = await request(`../assets/search-${encodeURIComponent(language)}.json`);
    const payload = await response.json();
    entries = Array.isArray(payload.entries) ? payload.entries : [];
    return entries;
  };

  const dismiss = () => {
    searchVersion += 1;
    collapse();
  };

  const search = async () => {
    const version = ++searchVersion;
    const query = input.value.trim().toLowerCase();
    if (query.length === 0) {
      collapse();
      return;
    }
    let index = [];
    try {
      index = await load();
    } catch {
      if (version === searchVersion) collapse();
      return;
    }
    if (version !== searchVersion || input.value.trim().toLowerCase() !== query) return;
    const matches = index
      .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
      .map((item) => item.entry);
    render(matches);
  };

  input.addEventListener("input", search);
  input.addEventListener("focus", () => {
    if (input.value.trim().length > 0) search();
  });
  input.addEventListener("keydown", (event) => {
    if (results.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      options[activeIndex].click();
    }
  });
  root.addEventListener("click", (event) => {
    if (!results.contains(event.target) && event.target !== input) dismiss();
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dismiss();
      return;
    }
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(root.activeElement?.tagName ?? "");
    if (event.key === "/" && !typing) {
      event.preventDefault();
      input.focus();
    }
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  setupTheme();
  setupLanguageMemory();
  setupSidebar();
  setupCopyButtons();
  setupTableOfContents();
  setupSearch();
}
