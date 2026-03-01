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


function normalizeProviderContentBlock(provider, block) {
  if (!isObject(block)) {
    return block;
  }

  if (provider === "openai" && block.type === "input_text" && typeof block.text === "string") {
    return { ...block, type: "text" };
  }

  if (provider === "anthropic" && block.type === "image_url" && typeof block.image_url === "string") {
    return {
      type: "image",
      source: {
        type: "url",
        url: block.image_url,
      },
    };
  }

  return block;
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
 * Normalize message arrays into a safe, provider-friendly shape.
 * - keeps role when provided
 * - normalizes each message.content through block normalization
 * - removes messages whose normalized content is empty
 *
 * @param {unknown} messages
 * @param {{ keepEmptyMessages?: boolean, provider?: string, profileMode?: "basic" | "off" }} [options]
 * @returns {Array<{ role?: string, content: ContentBlock[] } & Record<string, unknown>>}
 */
export function sanitizeMessages(messages, options = {}) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const keepEmptyMessages = options.keepEmptyMessages === true;
  const provider = options.provider || DEFAULT_PROVIDER;
  const profileMode = options.profileMode || "basic";

  const normalizedMessages = messages
    .filter((message) => isObject(message))
    .map((message) => ({
      ...message,
      content: removeEmptyTextBlocks(normalizeContentBlocks(message.content))
        .map((block) => (profileMode === "off" ? block : normalizeProviderContentBlock(provider, block))),
    }));

  if (keepEmptyMessages) {
    return normalizedMessages;
  }

  return normalizedMessages
    .filter((message) => Array.isArray(message.content) && message.content.length > 0);
}

/**
 * Summarize sanitize impact for observability/debug UX.
 *
 * @param {unknown} originalMessages
 * @param {Array<{ content?: unknown[] }>} sanitizedMessages
 * @returns {{ inputMessages: number, outputMessages: number, removedMessages: number, inputBlocks: number, outputBlocks: number, removedBlocks: number }}
 */
export function summarizeSanitizeImpact(originalMessages, sanitizedMessages) {
  const inputMessages = Array.isArray(originalMessages) ? originalMessages.length : 0;
  const outputMessages = Array.isArray(sanitizedMessages) ? sanitizedMessages.length : 0;
  const removedMessages = Math.max(0, inputMessages - outputMessages);
  const inputBlocks = Array.isArray(originalMessages)
    ? originalMessages.reduce((acc, msg) => acc + normalizeContentBlocks(msg?.content).length, 0)
    : 0;
  const outputBlocks = Array.isArray(sanitizedMessages)
    ? sanitizedMessages.reduce((acc, msg) => acc + (Array.isArray(msg.content) ? msg.content.length : 0), 0)
    : 0;

  return {
    inputMessages,
    outputMessages,
    removedMessages,
    inputBlocks,
    outputBlocks,
    removedBlocks: Math.max(0, inputBlocks - outputBlocks),
  };
}

/**
 * Summarize full payload sanitize impact, including top-level content blocks.
 *
 * @param {{ content?: unknown, messages?: unknown }} originalPayload
 * @param {{ content?: unknown, messages?: unknown }} sanitizedPayload
 */
export function summarizePayloadImpact(originalPayload, sanitizedPayload) {
  const inputContentBlocks = normalizeContentBlocks(originalPayload?.content).length;
  const outputContentBlocks = Array.isArray(sanitizedPayload?.content) ? sanitizedPayload.content.length : 0;

  return {
    ...summarizeSanitizeImpact(originalPayload?.messages, sanitizedPayload?.messages),
    inputContentBlocks,
    outputContentBlocks,
    removedContentBlocks: Math.max(0, inputContentBlocks - outputContentBlocks),
  };
}

/**
 * Run preflight sanitization + provider/global hooks.
 *
 * @param {{ content?: unknown, messages?: unknown } & Record<string, unknown>} payload
 * @param {{ provider?: string, keepEmptyMessages?: boolean, profileMode?: "basic" | "off", includeImpact?: boolean }} [options]
 * @returns {SanitizedPayload}
 */
export function runPreflightGuards(payload, options = {}) {
  const provider = options.provider || DEFAULT_PROVIDER;
  const profileMode = options.profileMode || "basic";

  const messages = sanitizeMessages(payload?.messages, {
    keepEmptyMessages: options.keepEmptyMessages === true,
    provider,
    profileMode,
  });

  let sanitized = {
    ...payload,
    content: removeEmptyTextBlocks(normalizeContentBlocks(payload?.content))
      .map((block) => (profileMode === "off" ? block : normalizeProviderContentBlock(provider, block))),
    messages,
  };

  if (options.includeImpact === true) {
    sanitized.sanitizeImpact = summarizePayloadImpact(payload, sanitized);
  }

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
