const LABELS = Object.freeze({
  en: Object.freeze({
    mainNavigation: "Main navigation",
    sidebarNavigation: "Documentation navigation",
    openMobileNavigation: "Open mobile navigation",
    closeMobileNavigation: "Close mobile navigation",
    extraNavigation: "More navigation",
    toggleSection: "Expand or collapse section",
    pager: "Page navigation",
    copyCode: "Copy code",
    copiedCode: "Code copied",
    switchToLight: "Switch to light theme",
    switchToDark: "Switch to dark theme",
    permalink: (title) => `Permalink to "${title}"`,
  }),
  zh: Object.freeze({
    mainNavigation: "主导航",
    sidebarNavigation: "文档导航",
    openMobileNavigation: "打开移动导航",
    closeMobileNavigation: "关闭移动导航",
    extraNavigation: "更多导航",
    toggleSection: "展开或收起章节",
    pager: "页面导航",
    copyCode: "复制代码",
    copiedCode: "代码已复制",
    switchToLight: "切换到浅色模式",
    switchToDark: "切换到深色模式",
    permalink: (title) => `“${title}”的永久链接`,
  }),
});

const INSTALL_KEY = Symbol.for("openclaw-weixin.theme-accessibility");
const announcedCopies = new WeakSet();

export function labelsForLanguage(language) {
  return String(language).toLowerCase().startsWith("zh") ? LABELS.zh : LABELS.en;
}

function setText(element, value) {
  if (element && element.textContent?.trim() !== value) element.textContent = value;
}

function setLabel(element, value) {
  if (element && element.getAttribute("aria-label") !== value) {
    element.setAttribute("aria-label", value);
  }
}

export function configureSidebarCaret(caret, label) {
  const row = caret.parentElement;
  if (row?.getAttribute("role") === "button") {
    const section = row.parentElement;
    const expanded = String(!section?.classList.contains("collapsed"));
    if (row.getAttribute("aria-expanded") !== expanded) {
      row.setAttribute("aria-expanded", expanded);
    }
    caret.setAttribute("aria-hidden", "true");
    caret.removeAttribute("aria-label");
    caret.removeAttribute("role");
    caret.removeAttribute("tabindex");
    return;
  }

  caret.removeAttribute("aria-hidden");
  setLabel(caret, label);
}

function copyStatusRegion(document) {
  let region = document.getElementById("docs-copy-status");
  if (region) return region;
  region = document.createElement("div");
  region.id = "docs-copy-status";
  region.className = "visually-hidden";
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  document.body.append(region);
  return region;
}

export function applyThemeAccessibility(root = document) {
  const document = root.ownerDocument ?? root;
  const labels = labelsForLanguage(document.documentElement.lang);

  setText(root.querySelector("#main-nav-aria-label"), labels.mainNavigation);
  setText(root.querySelector("#sidebar-aria-label"), labels.sidebarNavigation);
  setText(root.querySelector("#doc-footer-aria-label"), labels.pager);
  const mobileNavigation = root.querySelector(".VPNavBarHamburger");
  setLabel(
    mobileNavigation,
    mobileNavigation?.getAttribute("aria-expanded") === "true"
      ? labels.closeMobileNavigation
      : labels.openMobileNavigation,
  );
  setLabel(root.querySelector(".VPNavBarExtra > button"), labels.extraNavigation);

  for (const caret of root.querySelectorAll(".VPSidebarItem .caret")) {
    configureSidebarCaret(caret, labels.toggleSection);
  }

  for (const button of root.querySelectorAll(".VPSwitchAppearance")) {
    const label =
      button.getAttribute("aria-checked") === "true" ? labels.switchToLight : labels.switchToDark;
    setLabel(button, label);
    if (button.title !== label) button.title = label;
  }

  for (const button of root.querySelectorAll("button.copy")) {
    const copied = button.classList.contains("copied");
    const label = copied ? labels.copiedCode : labels.copyCode;
    setLabel(button, label);
    if (button.title !== label) button.title = label;
    if (copied && !announcedCopies.has(button)) {
      const region = copyStatusRegion(document);
      region.textContent = "";
      requestAnimationFrame(() => {
        region.textContent = labels.copiedCode;
      });
      announcedCopies.add(button);
    } else if (!copied) {
      announcedCopies.delete(button);
    }
  }

  for (const anchor of root.querySelectorAll(".header-anchor")) {
    const heading = anchor.closest("h1, h2, h3, h4, h5, h6");
    if (!heading) continue;
    const title = [...heading.childNodes]
      .filter((node) => node !== anchor)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    if (title) setLabel(anchor, labels.permalink(title));
  }
}

export function installThemeAccessibility(router) {
  if (typeof window === "undefined") return;

  let frame;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => applyThemeAccessibility(document));
  };

  if (window[INSTALL_KEY]) {
    schedule();
    return;
  }
  window[INSTALL_KEY] = true;

  const previousAfterRouteChanged = router.onAfterRouteChanged;
  router.onAfterRouteChanged = async (...args) => {
    await previousAfterRouteChanged?.(...args);
    schedule();
  };

  const start = () => {
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-checked", "aria-expanded", "class"],
      childList: true,
      subtree: true,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
