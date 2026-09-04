export const REGISTRY_README_FILES = ["README.md", "README_EN.md"];
export const REGISTRY_SOURCES = ["npm", "clawhub"];
export const REGISTRY_README_TITLES = {
  npm: "openclaw-weixin",
  clawhub: "openclaw-wechat",
};
export const REGISTRY_INSTALL_SPECS = {
  npm: "npm:openclaw-weixin",
  clawhub: "clawhub:openclaw-wechat",
};
export const REGISTRY_INSTALL_COMMANDS = {
  npm: `openclaw plugins install ${REGISTRY_INSTALL_SPECS.npm}`,
  clawhub: `openclaw plugins install ${REGISTRY_INSTALL_SPECS.clawhub}`,
};

export function registrySourceMarker(source, boundary) {
  if (!REGISTRY_SOURCES.includes(source)) {
    throw new Error(`unknown registry README source: ${source}`);
  }
  if (boundary !== "start" && boundary !== "end") {
    throw new Error(`unknown registry README marker boundary: ${boundary}`);
  }
  return `<!-- registry-source:${source}:${boundary} -->`;
}

export function registryPromptMarker(boundary) {
  if (boundary !== "start" && boundary !== "end") {
    throw new Error(`unknown registry prompt marker boundary: ${boundary}`);
  }
  return `<!-- registry-prompt:${boundary} -->`;
}

function countOccurrences(value, fragment) {
  return value.split(fragment).length - 1;
}

function singleBacktickCodeSpans(value) {
  return [...value.matchAll(/(?<!`)`([^`\r\n]+)`(?!`)/g)].map((match) => match[1]);
}

function countExactCommandLines(value, command) {
  return value.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed === command || trimmed === `\`${command}\``;
  }).length;
}

function readmeError(fileName, message) {
  return new Error(`${fileName}: ${message}`);
}

export function inspectRegistryReadme(markdown, { fileName = "README" } = {}) {
  if (typeof markdown !== "string") {
    throw readmeError(fileName, "content must be a string");
  }

  const blocks = {};
  for (const source of REGISTRY_SOURCES) {
    const startMarker = registrySourceMarker(source, "start");
    const endMarker = registrySourceMarker(source, "end");
    const startCount = countOccurrences(markdown, startMarker);
    const endCount = countOccurrences(markdown, endMarker);
    if (startCount !== 1 || endCount !== 1) {
      throw readmeError(
        fileName,
        `${source} source markers must appear exactly once (start=${startCount}, end=${endCount})`,
      );
    }

    const start = markdown.indexOf(startMarker);
    const bodyStart = start + startMarker.length;
    const endMarkerStart = markdown.indexOf(endMarker);
    if (endMarkerStart <= bodyStart) {
      throw readmeError(fileName, `${source} source markers are reversed, nested, or empty`);
    }
    const body = markdown.slice(bodyStart, endMarkerStart);
    if (!body.trim()) {
      throw readmeError(fileName, `${source} source block is empty`);
    }

    blocks[source] = {
      source,
      start,
      end: endMarkerStart + endMarker.length,
      value: markdown.slice(start, endMarkerStart + endMarker.length),
    };
  }

  const ordered = Object.values(blocks).sort((left, right) => left.start - right.start);
  const [first, second] = ordered;
  if (first.end > second.start) {
    throw readmeError(fileName, "registry source blocks overlap or are nested");
  }
  const separator = markdown.slice(first.end, second.start);
  if (!separator || separator.trim()) {
    throw readmeError(fileName, "registry source blocks must be adjacent and separated only by whitespace");
  }

  return {
    blocks,
    order: ordered.map((entry) => entry.source),
    prefix: markdown.slice(0, first.start),
    separator,
    suffix: markdown.slice(second.end),
  };
}

export function assertRegistryReadmeOrder(markdown, expectedFirst, options) {
  if (!REGISTRY_SOURCES.includes(expectedFirst)) {
    throw new Error(`unknown preferred registry README source: ${expectedFirst}`);
  }
  const inspected = inspectRegistryReadme(markdown, options);
  if (inspected.order[0] !== expectedFirst) {
    const fileName = options?.fileName ?? "README";
    throw readmeError(fileName, `expected ${expectedFirst} source first, found ${inspected.order[0]}`);
  }
  return inspected;
}

export function inspectRegistryPrompt(markdown, { fileName = "README" } = {}) {
  if (typeof markdown !== "string") {
    throw readmeError(fileName, "content must be a string");
  }
  const startMarker = registryPromptMarker("start");
  const endMarker = registryPromptMarker("end");
  const startCount = countOccurrences(markdown, startMarker);
  const endCount = countOccurrences(markdown, endMarker);
  if (startCount !== 1 || endCount !== 1) {
    throw readmeError(fileName, `prompt markers must appear exactly once (start=${startCount}, end=${endCount})`);
  }
  const start = markdown.indexOf(startMarker);
  const endMarkerStart = markdown.indexOf(endMarker);
  if (endMarkerStart <= start + startMarker.length) {
    throw readmeError(fileName, "prompt markers are reversed or empty");
  }
  const prompt = {
    start,
    end: endMarkerStart + endMarker.length,
    value: markdown.slice(start, endMarkerStart + endMarker.length),
  };
  if (/\bopenclaw\s+plugins\s+install\b/iu.test(prompt.value)) {
    throw readmeError(fileName, "shared prompt must describe installation in natural language, not embed a full CLI");
  }
  const codeSpans = singleBacktickCodeSpans(prompt.value);
  for (const source of REGISTRY_SOURCES) {
    const expectedSpec = REGISTRY_INSTALL_SPECS[source];
    const specCount = codeSpans.filter((value) => value === expectedSpec).length;
    if (specCount !== 1) {
      throw readmeError(fileName, `shared prompt must include \`${expectedSpec}\` exactly once (found ${specCount})`);
    }
  }
  const forceCount = codeSpans.filter((value) => value === "--force").length;
  if (forceCount !== 1) {
    throw readmeError(fileName, `shared prompt must describe \`--force\` exactly once (found ${forceCount})`);
  }
  const forceSentence = prompt.value.split(/[.!?。！？]+/u).find((sentence) => sentence.includes("`--force`"));
  const forceProse = forceSentence?.replace(/`[^`]+`/gu, (code) => (code === "`--force`" ? code : ""));
  const forceScopedToNpmInstallation =
    /\bnpm\s+install(?:ation|ations)?\b/iu.test(forceProse) || /npm\s*安装/u.test(forceProse);
  if (!forceProse || !forceScopedToNpmInstallation || /\bClawHub\b/iu.test(forceProse)) {
    throw readmeError(fileName, "shared prompt must scope `--force` to npm installation");
  }
  return prompt;
}

function registryPromptOrder(prompt) {
  return [...REGISTRY_SOURCES].sort(
    (left, right) =>
      prompt.value.indexOf(`\`${REGISTRY_INSTALL_SPECS[left]}\``) -
      prompt.value.indexOf(`\`${REGISTRY_INSTALL_SPECS[right]}\``),
  );
}

export function assertRegistryPromptOrder(markdown, expectedFirst, options) {
  if (!REGISTRY_SOURCES.includes(expectedFirst)) {
    throw new Error(`unknown preferred registry prompt source: ${expectedFirst}`);
  }
  const prompt = inspectRegistryPrompt(markdown, options);
  const order = registryPromptOrder(prompt);
  if (order[0] !== expectedFirst) {
    const fileName = options?.fileName ?? "README";
    throw readmeError(fileName, `expected ${expectedFirst} prompt source first, found ${order[0]}`);
  }
  return { ...prompt, order };
}

export function preferRegistryPromptSource(markdown, preferredSource, options) {
  if (!REGISTRY_SOURCES.includes(preferredSource)) {
    throw new Error(`unknown preferred registry prompt source: ${preferredSource}`);
  }
  const prompt = inspectRegistryPrompt(markdown, options);
  if (registryPromptOrder(prompt)[0] === preferredSource) return markdown;

  const fallbackSource = REGISTRY_SOURCES.find((source) => source !== preferredSource);
  const preferredSpec = `\`${REGISTRY_INSTALL_SPECS[preferredSource]}\``;
  const fallbackSpec = `\`${REGISTRY_INSTALL_SPECS[fallbackSource]}\``;
  const fallbackIndex = prompt.value.indexOf(fallbackSpec);
  const preferredIndex = prompt.value.indexOf(preferredSpec);
  const value =
    prompt.value.slice(0, fallbackIndex) +
    preferredSpec +
    prompt.value.slice(fallbackIndex + fallbackSpec.length, preferredIndex) +
    fallbackSpec +
    prompt.value.slice(preferredIndex + preferredSpec.length);
  return markdown.slice(0, prompt.start) + value + markdown.slice(prompt.end);
}

export function assertRegistryReadmeTitle(markdown, expectedSource, options) {
  if (!REGISTRY_SOURCES.includes(expectedSource)) {
    throw new Error(`unknown registry README title source: ${expectedSource}`);
  }
  const fileName = options?.fileName ?? "README";
  if (typeof markdown !== "string") {
    throw readmeError(fileName, "content must be a string");
  }
  const title = /^# ([^\r\n]+)(?:\r?\n|$)/.exec(markdown)?.[1];
  const expectedTitle = REGISTRY_README_TITLES[expectedSource];
  if (title !== expectedTitle) {
    throw readmeError(fileName, `expected title ${expectedTitle}, found ${title ?? "none"}`);
  }
  return title;
}

export function preferRegistryReadmeTitle(markdown, preferredSource, options) {
  if (!REGISTRY_SOURCES.includes(preferredSource)) {
    throw new Error(`unknown preferred registry README title source: ${preferredSource}`);
  }
  const fileName = options?.fileName ?? "README";
  if (typeof markdown !== "string") {
    throw readmeError(fileName, "content must be a string");
  }
  const titleMatch = /^# ([^\r\n]+)(\r?\n|$)/.exec(markdown);
  const currentSource = REGISTRY_SOURCES.find((source) => REGISTRY_README_TITLES[source] === titleMatch?.[1]);
  if (!currentSource) {
    throw readmeError(fileName, `unrecognized registry README title: ${titleMatch?.[1] ?? "none"}`);
  }
  if (currentSource === preferredSource) return markdown;
  return `# ${REGISTRY_README_TITLES[preferredSource]}${titleMatch[2]}${markdown.slice(titleMatch[0].length)}`;
}

export function assertRegistryReadmeInstallCommands(markdown, options) {
  const inspected = inspectRegistryReadme(markdown, options);
  const fileName = options?.fileName ?? "README";
  for (const source of REGISTRY_SOURCES) {
    const block = inspected.blocks[source].value;
    const expectedCommand = REGISTRY_INSTALL_COMMANDS[source];
    const commandCount = countExactCommandLines(block, expectedCommand);
    if (commandCount !== 1) {
      throw readmeError(
        fileName,
        `${source} source block must include \`${expectedCommand}\` exactly once (found ${commandCount})`,
      );
    }
    const forcedCommand = `${expectedCommand} --force`;
    if (block.includes(forcedCommand)) {
      throw readmeError(fileName, `${source} source block must not include \`${forcedCommand}\``);
    }
    for (const otherSource of REGISTRY_SOURCES.filter((entry) => entry !== source)) {
      const unexpectedSpec = REGISTRY_INSTALL_SPECS[otherSource];
      if (block.includes(unexpectedSpec)) {
        throw readmeError(fileName, `${source} source block must not include \`${unexpectedSpec}\``);
      }
    }
  }
  return inspected;
}

export function assertSourceRegistryReadme(markdown, options) {
  assertRegistryReadmeTitle(markdown, "npm", options);
  assertRegistryReadmeOrder(markdown, "clawhub", options);
  assertRegistryPromptOrder(markdown, "clawhub", options);
  assertRegistryReadmeInstallCommands(markdown, options);
  assertRegistryReadmeLinksAbsolute(markdown, options);
}

function isMarkdownEscaped(value, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function readMarkdownLinkTarget(value, start, { inline }) {
  let cursor = start;
  while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
  if (value[cursor] === "<") {
    const targetStart = cursor;
    cursor += 1;
    while (cursor < value.length) {
      if (value[cursor] === ">" && !isMarkdownEscaped(value, cursor)) {
        return value.slice(targetStart, cursor + 1);
      }
      if (value[cursor] === "\n") break;
      cursor += 1;
    }
    return value.slice(targetStart, cursor);
  }

  const targetStart = cursor;
  let parentheses = 0;
  while (cursor < value.length) {
    const character = value[cursor];
    if (!isMarkdownEscaped(value, cursor)) {
      if (inline && character === "(") {
        parentheses += 1;
      } else if (inline && character === ")") {
        if (parentheses === 0) break;
        parentheses -= 1;
      } else if (/\s/.test(character) && parentheses === 0) {
        break;
      }
    }
    cursor += 1;
  }
  return value.slice(targetStart, cursor);
}

function markdownInlineLinkTargets(content) {
  const targets = [];
  for (let index = 0; index < content.length - 1; index += 1) {
    if (content[index] !== "]" || content[index + 1] !== "(" || isMarkdownEscaped(content, index)) continue;
    targets.push(readMarkdownLinkTarget(content, index + 2, { inline: true }));
  }
  return targets;
}

function markdownReferenceLinkTargets(content) {
  const targets = [];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "[") continue;
    let cursor = index + 1;
    while (cursor < content.length && cursor - index <= 1_000) {
      if (content[cursor] === "]" && !isMarkdownEscaped(content, cursor)) break;
      cursor += 1;
    }
    if (content[cursor] !== "]") continue;
    cursor += 1;
    while (cursor < content.length && /[ \t]/.test(content[cursor])) cursor += 1;
    if (content[cursor] !== ":") continue;
    targets.push(readMarkdownLinkTarget(content, cursor + 1, { inline: false }));
  }
  return targets;
}

function htmlAttributeLinkTargets(content) {
  const targets = [];
  const attributeStart = /\b(?:href|src)\s*=/gi;
  for (const match of content.matchAll(attributeStart)) {
    let cursor = (match.index ?? 0) + match[0].length;
    while (cursor < content.length && /\s/.test(content[cursor])) cursor += 1;
    const quote = content[cursor] === '"' || content[cursor] === "'" ? content[cursor] : undefined;
    if (quote) {
      const targetStart = cursor + 1;
      cursor = content.indexOf(quote, targetStart);
      targets.push(cursor === -1 ? "" : content.slice(targetStart, cursor));
      continue;
    }
    const targetStart = cursor;
    while (cursor < content.length && !/[\s"'=<>`]/.test(content[cursor])) cursor += 1;
    targets.push(content.slice(targetStart, cursor));
  }
  return targets;
}

function normalizeLinkTarget(target) {
  const trimmed = target.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
}

function isRegistrySafeLinkTarget(target) {
  return target.startsWith("#") || /^https?:\/\//i.test(target) || /^mailto:/i.test(target);
}

export function assertRegistryReadmeLinksAbsolute(markdown, options) {
  if (typeof markdown !== "string") {
    throw readmeError(options?.fileName ?? "README", "content must be a string");
  }
  const fileName = options?.fileName ?? "README";
  const targets = [
    ...markdownInlineLinkTargets(markdown),
    ...markdownReferenceLinkTargets(markdown),
    ...htmlAttributeLinkTargets(markdown),
  ];
  for (let index = 0; index < targets.length; index += 1) {
    targets[index] = normalizeLinkTarget(targets[index]);
  }
  const unsafeTarget = targets.find((target) => !isRegistrySafeLinkTarget(target));
  if (unsafeTarget !== undefined) {
    throw readmeError(fileName, `link target must be absolute or fragment-only: ${JSON.stringify(unsafeTarget)}`);
  }
  return targets;
}

export function preferRegistryReadmeSource(markdown, preferredSource, options) {
  const inspected = inspectRegistryReadme(markdown, options);
  if (!REGISTRY_SOURCES.includes(preferredSource)) {
    throw new Error(`unknown preferred registry README source: ${preferredSource}`);
  }
  if (inspected.order[0] === preferredSource) {
    return markdown;
  }

  const fallbackSource = REGISTRY_SOURCES.find((source) => source !== preferredSource);
  return (
    inspected.prefix +
    inspected.blocks[preferredSource].value +
    inspected.separator +
    inspected.blocks[fallbackSource].value +
    inspected.suffix
  );
}
