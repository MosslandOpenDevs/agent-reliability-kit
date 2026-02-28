/**
 * @typedef {Record<string, unknown>} ContentBlock
 * @typedef {"*" | string} ProviderName
 * @typedef {{ provider: string, payload: SanitizedPayload }} PreflightContext
 * @typedef {(context: PreflightContext) => SanitizedPayload | void} PreflightHook
 *
 * @typedef SanitizedPayload
 * @property {ContentBlock[]} content
 */

const DEFAULT_PROVIDER = "*";

/** @type {Map<ProviderName, PreflightHook[]>} */
const preflightGuardHooks = new Map([[DEFAULT_PROVIDER, []]]);

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function toTextBlock(text) {
  return { type: "text", text };
}

function isTextBlock(block) {
  return isObject(block) && block.type === "text" && typeof block.text === "string";
}

/**
 * Remove text blocks whose text value is empty/whitespace-only.
 * Non-text blocks are preserved as-is.
 *
 * @param {unknown} blocks
 * @returns {ContentBlock[]}
 */
export function removeEmptyTextBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.filter((block) => {
    if (!isTextBlock(block)) {
      return true;
    }

    return block.text.trim().length > 0;
  });
}

/**
 * Normalize model message content into a content-block array.
 * - string -> [{ type: "text", text: string }]
 * - array<string|object> -> object blocks (string entries become text blocks)
 * - null/undefined/unsupported -> []
 *
 * @param {unknown} content
 * @returns {ContentBlock[]}
 */
export function normalizeContentBlocks(content) {
  if (typeof content === "string") {
    return [toTextBlock(content)];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  /** @type {ContentBlock[]} */
  const normalized = [];

  for (const entry of content) {
    if (typeof entry === "string") {
      normalized.push(toTextBlock(entry));
      continue;
    }

    if (!isObject(entry)) {
      continue;
    }

    if (entry.type === "text" && typeof entry.text === "string") {
      normalized.push(entry);
      continue;
    }

    if (entry.type === "text" && typeof entry.content === "string") {
      normalized.push({ ...entry, text: entry.content });
      continue;
    }

    normalized.push(entry);
  }

  return normalized;
}

/**
 * Register a preflight hook.
 * Use provider "*" to apply globally.
 *
 * @param {ProviderName} provider
 * @param {PreflightHook} hook
 */
export function registerPreflightGuard(provider, hook) {
  const providerKey = provider || DEFAULT_PROVIDER;

  if (!preflightGuardHooks.has(providerKey)) {
    preflightGuardHooks.set(providerKey, []);
  }

  preflightGuardHooks.get(providerKey).push(hook);
}

/**
 * Remove all registered hooks.
 * Useful for deterministic test setup.
 */
export function clearPreflightGuards() {
  preflightGuardHooks.clear();
  preflightGuardHooks.set(DEFAULT_PROVIDER, []);
}

/**
 * Run preflight sanitization + provider/global hooks.
 *
 * @param {{ content?: unknown } & Record<string, unknown>} payload
 * @param {{ provider?: string }} [options]
 * @returns {SanitizedPayload}
 */
export function runPreflightGuards(payload, options = {}) {
  const provider = options.provider || DEFAULT_PROVIDER;
  let sanitized = {
    ...payload,
    content: removeEmptyTextBlocks(normalizeContentBlocks(payload?.content)),
  };

  const hooks = [
    ...(preflightGuardHooks.get(DEFAULT_PROVIDER) || []),
    ...(preflightGuardHooks.get(provider) || []),
  ];

  for (const hook of hooks) {
    const next = hook({ provider, payload: sanitized });
    if (isObject(next) && Array.isArray(next.content)) {
      sanitized = next;
    }
  }

  return sanitized;
}
