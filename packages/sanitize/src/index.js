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

function limitTextBlockLength(block, maxTextLength) {
  if (!isTextBlock(block)) {
    return block;
  }

  if (!Number.isFinite(maxTextLength) || maxTextLength < 0) {
    return block;
  }

  if (block.text.length <= maxTextLength) {
    return block;
  }

  return {
    ...block,
    text: block.text.slice(0, maxTextLength),
  };
}

/**
 * Merge consecutive text blocks into a single text block.
 * Preserves non-text block boundaries.
 *
 * @param {ContentBlock[]} blocks
 * @returns {ContentBlock[]}
 */
export function mergeAdjacentTextBlocks(blocks, separator = "\n") {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [];
  }

  /** @type {ContentBlock[]} */
  const merged = [];

  for (const block of blocks) {
    const previous = merged[merged.length - 1];

    if (isTextBlock(previous) && isTextBlock(block)) {
      previous.text = `${previous.text}${separator}${block.text}`;
      continue;
    }

    merged.push(block);
  }

  return merged;
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
 * @param {{ keepEmptyMessages?: boolean, provider?: string, profileMode?: "basic" | "off", mergeAdjacentText?: boolean, mergeSeparator?: string, trimMergedText?: boolean, collapseMergedWhitespace?: boolean, maxTextLength?: number, maxBlockCount?: number }} [options]
 * @returns {Array<{ role?: string, content: ContentBlock[] } & Record<string, unknown>>}
 */
export function sanitizeMessages(messages, options = {}) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const keepEmptyMessages = options.keepEmptyMessages === true;
  const provider = options.provider || DEFAULT_PROVIDER;
  const profileMode = options.profileMode || "basic";

  const mergeAdjacentText = options.mergeAdjacentText === true;
  const mergeSeparator = typeof options.mergeSeparator === "string" ? options.mergeSeparator : "\n";
  const trimMergedText = options.trimMergedText === true;
  const collapseMergedWhitespace = options.collapseMergedWhitespace === true;
  const maxTextLength = Number.isFinite(options.maxTextLength) ? Number(options.maxTextLength) : null;
  const maxBlockCount = Number.isInteger(options.maxBlockCount) && options.maxBlockCount >= 0
    ? Number(options.maxBlockCount)
    : null;

  const normalizedMessages = messages
    .filter((message) => isObject(message))
    .map((message) => {
      const normalizedContent = removeEmptyTextBlocks(normalizeContentBlocks(message.content))
        .map((block) => (profileMode === "off" ? block : normalizeProviderContentBlock(provider, block)));

      const mergedContent = mergeAdjacentText
        ? mergeAdjacentTextBlocks(normalizedContent, mergeSeparator)
        : normalizedContent;

      const normalizedMergedContent = mergedContent.map((block) => {
        if (!isTextBlock(block)) {
          return block;
        }

        let text = block.text;
        if (trimMergedText) {
          text = text.trim();
        }
        if (collapseMergedWhitespace) {
          text = text.replace(/\s+/g, " ").trim();
        }

        return limitTextBlockLength({ ...block, text }, maxTextLength);
      });

      const normalizedMergedWithoutEmpty = removeEmptyTextBlocks(normalizedMergedContent);
      const normalizedCappedContent = maxBlockCount !== null
        ? normalizedMergedWithoutEmpty.slice(0, maxBlockCount)
        : normalizedMergedWithoutEmpty;

      return {
        ...message,
        content: normalizedCappedContent,
      };
    });

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

  const roleCount = (messages) => {
    if (!Array.isArray(messages)) {
      return {};
    }

    return messages.reduce((acc, message) => {
      const key = typeof message?.role === "string" && message.role.trim().length > 0
        ? message.role
        : "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  };

  const removedBlocks = Math.max(0, inputBlocks - outputBlocks);

  const countTextChars = (messages) => {
    if (!Array.isArray(messages)) {
      return 0;
    }

    return messages.reduce((acc, message) => {
      const blocks = normalizeContentBlocks(message?.content);
      const textChars = blocks.reduce((sum, block) => {
        if (!isTextBlock(block)) {
          return sum;
        }
        return sum + block.text.length;
      }, 0);
      return acc + textChars;
    }, 0);
  };

  const inputTextChars = countTextChars(originalMessages);
  const outputTextChars = countTextChars(sanitizedMessages);
  const removedTextChars = Math.max(0, inputTextChars - outputTextChars);

  return {
    inputMessages,
    outputMessages,
    removedMessages,
    removedMessageRatio: inputMessages > 0 ? Number((removedMessages / inputMessages).toFixed(3)) : 0,
    inputBlocks,
    outputBlocks,
    removedBlocks,
    removedBlockRatio: inputBlocks > 0 ? Number((removedBlocks / inputBlocks).toFixed(3)) : 0,
    inputTextChars,
    outputTextChars,
    removedTextChars,
    removedTextCharRatio: inputTextChars > 0 ? Number((removedTextChars / inputTextChars).toFixed(3)) : 0,
    inputRoles: roleCount(originalMessages),
    outputRoles: roleCount(sanitizedMessages),
  };
}

/**
 * Summarize full payload sanitize impact, including top-level content blocks.
 *
 * @param {{ content?: unknown, messages?: unknown }} originalPayload
 * @param {{ content?: unknown, messages?: unknown }} sanitizedPayload
 */
export function summarizePayloadImpact(originalPayload, sanitizedPayload) {
  const inputContent = normalizeContentBlocks(originalPayload?.content);
  const outputContent = Array.isArray(sanitizedPayload?.content) ? sanitizedPayload.content : [];
  const inputContentBlocks = inputContent.length;
  const outputContentBlocks = outputContent.length;
  const messageImpact = summarizeSanitizeImpact(originalPayload?.messages, sanitizedPayload?.messages);

  const removedRoles = Object.keys(messageImpact.inputRoles)
    .filter((role) => (messageImpact.inputRoles[role] || 0) > (messageImpact.outputRoles[role] || 0));

  const countTextChars = (blocks) => (Array.isArray(blocks)
    ? blocks.reduce((acc, block) => {
      if (!isTextBlock(block)) {
        return acc;
      }
      return acc + block.text.length;
    }, 0)
    : 0);

  const inputContentTextChars = countTextChars(inputContent);
  const outputContentTextChars = countTextChars(outputContent);

  const removedContentBlocks = Math.max(0, inputContentBlocks - outputContentBlocks);
  const removedContentTextChars = Math.max(0, inputContentTextChars - outputContentTextChars);

  const inputTotalTextChars = messageImpact.inputTextChars + inputContentTextChars;
  const outputTotalTextChars = messageImpact.outputTextChars + outputContentTextChars;
  const removedTotalTextChars = Math.max(0, inputTotalTextChars - outputTotalTextChars);

  return {
    ...messageImpact,
    removedRoles,
    removedRoleCount: removedRoles.length,
    inputContentBlocks,
    outputContentBlocks,
    removedContentBlocks,
    removedContentBlockRatio: inputContentBlocks > 0 ? Number((removedContentBlocks / inputContentBlocks).toFixed(3)) : 0,
    inputContentTextChars,
    outputContentTextChars,
    removedContentTextChars,
    removedContentTextCharRatio: inputContentTextChars > 0 ? Number((removedContentTextChars / inputContentTextChars).toFixed(3)) : 0,
    inputTotalTextChars,
    outputTotalTextChars,
    removedTotalTextChars,
    removedTotalTextCharRatio: inputTotalTextChars > 0 ? Number((removedTotalTextChars / inputTotalTextChars).toFixed(3)) : 0,
  };
}

/**
 * Run preflight sanitization + provider/global hooks.
 *
 * @param {{ content?: unknown, messages?: unknown } & Record<string, unknown>} payload
 * @param {{ provider?: string, keepEmptyMessages?: boolean, profileMode?: "basic" | "off", includeImpact?: boolean, mergeAdjacentText?: boolean, mergeSeparator?: string, trimMergedText?: boolean, collapseMergedWhitespace?: boolean, maxTextLength?: number, maxBlockCount?: number }} [options]
 * @returns {SanitizedPayload}
 */
export function runPreflightGuards(payload, options = {}) {
  const provider = options.provider || DEFAULT_PROVIDER;
  const profileMode = options.profileMode || "basic";
  const maxTextLength = Number.isFinite(options.maxTextLength) ? Number(options.maxTextLength) : null;
  const maxBlockCount = Number.isInteger(options.maxBlockCount) && options.maxBlockCount >= 0
    ? Number(options.maxBlockCount)
    : null;

  const messages = sanitizeMessages(payload?.messages, {
    keepEmptyMessages: options.keepEmptyMessages === true,
    provider,
    profileMode,
    mergeAdjacentText: options.mergeAdjacentText === true,
    mergeSeparator: options.mergeSeparator,
    trimMergedText: options.trimMergedText === true,
    collapseMergedWhitespace: options.collapseMergedWhitespace === true,
    maxTextLength: options.maxTextLength,
    maxBlockCount: options.maxBlockCount,
  });

  const normalizedTopLevelContent = removeEmptyTextBlocks(normalizeContentBlocks(payload?.content))
    .map((block) => (profileMode === "off" ? block : normalizeProviderContentBlock(provider, block)));

  const mergedTopLevelContent = options.mergeAdjacentText === true
    ? mergeAdjacentTextBlocks(
      normalizedTopLevelContent,
      typeof options.mergeSeparator === "string" ? options.mergeSeparator : "\n",
    )
    : normalizedTopLevelContent;

  const normalizedTopLevelMergedContent = removeEmptyTextBlocks(
    mergedTopLevelContent.map((block) => {
      if (!isTextBlock(block)) {
        return block;
      }

      let text = block.text;
      if (options.trimMergedText === true) {
        text = text.trim();
      }
      if (options.collapseMergedWhitespace === true) {
        text = text.replace(/\s+/g, " ").trim();
      }

      return limitTextBlockLength({ ...block, text }, maxTextLength);
    }),
  );

  const normalizedTopLevelCappedContent = maxBlockCount !== null
    ? normalizedTopLevelMergedContent.slice(0, maxBlockCount)
    : normalizedTopLevelMergedContent;

  let sanitized = {
    ...payload,
    content: normalizedTopLevelCappedContent,
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
