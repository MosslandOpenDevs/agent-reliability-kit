/**
 * @ark/sanitize — request payload normalization and preflight cleanup.
 *
 * Normalizes model message content into a safe, provider-friendly shape and
 * runs registered preflight guard hooks before a request leaves your process.
 */

/** An arbitrary content block. Text blocks additionally carry a `text` field. */
export type ContentBlock = Record<string, unknown>;

/** A normalized text content block. */
export interface TextBlock extends ContentBlock {
  type: "text";
  text: string;
}

/** A message with normalized content blocks. */
export type SanitizedMessage = {
  role?: string;
  content: ContentBlock[];
} & Record<string, unknown>;

/** A payload with normalized top-level content (and optional messages). */
export type SanitizedPayload = {
  content: ContentBlock[];
  messages?: SanitizedMessage[];
} & Record<string, unknown>;

/** Context passed to a preflight hook. */
export interface PreflightContext {
  provider: string;
  payload: SanitizedPayload;
}

/** A preflight hook: return a new payload to replace it, or nothing to keep it. */
// biome-ignore lint/suspicious/noConfusingVoidType: a hook may return nothing to keep the payload unchanged
export type PreflightHook = (context: PreflightContext) => SanitizedPayload | void;

/** Options shared by {@link sanitizeMessages} and {@link runPreflightGuards}. */
export interface SanitizeOptions {
  keepEmptyMessages?: boolean;
  provider?: string;
  profileMode?: "basic" | "off";
  mergeAdjacentText?: boolean;
  mergeSeparator?: string;
  trimMergedText?: boolean;
  collapseMergedWhitespace?: boolean;
  stripControlChars?: boolean;
  stripAnsiEscapes?: boolean;
  stripHtmlTags?: boolean;
  stripMarkdownLinks?: boolean;
  stripMarkdownImages?: boolean;
  maxTextLength?: number;
  maxBlockCount?: number;
  /** Maximum messages examined and retained, as an ordered input prefix. */
  maxMessageCount?: number;
  /** Maximum content entries examined and blocks retained across the traversal. */
  maxTotalBlockCount?: number;
  /** Maximum UTF-16 text code units processed and retained across the traversal. */
  maxTotalTextChars?: number;
}

/** Options for {@link runPreflightGuards}. */
export interface PreflightOptions extends SanitizeOptions {
  includeImpact?: boolean;
}

/** Deterministic counters describing message-level sanitize impact. */
export interface SanitizeImpact {
  inputMessages: number;
  outputMessages: number;
  removedMessages: number;
  removedMessageRatio: number;
  inputBlocks: number;
  outputBlocks: number;
  removedBlocks: number;
  removedBlockRatio: number;
  inputTextChars: number;
  outputTextChars: number;
  removedTextChars: number;
  removedTextCharRatio: number;
  inputRoles: Record<string, number>;
  outputRoles: Record<string, number>;
}

/** {@link SanitizeImpact} extended with top-level content counters. */
export interface PayloadImpact extends SanitizeImpact {
  /** Input counters cover only the bounded prefix when an aggregate gate truncated input. */
  inputMetricsTruncated?: boolean;
  removedRoles: string[];
  removedRoleCount: number;
  inputContentBlocks: number;
  outputContentBlocks: number;
  removedContentBlocks: number;
  removedContentBlockRatio: number;
  inputContentTextChars: number;
  outputContentTextChars: number;
  removedContentTextChars: number;
  removedContentTextCharRatio: number;
  inputTotalBlocks: number;
  outputTotalBlocks: number;
  removedTotalBlocks: number;
  removedTotalBlockRatio: number;
  inputTotalTextChars: number;
  outputTotalTextChars: number;
  removedTotalTextChars: number;
  removedTotalTextCharRatio: number;
}

const DEFAULT_PROVIDER = "*";

const preflightGuardHooks = new Map<string, PreflightHook[]>([[DEFAULT_PROVIDER, []]]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTextBlock(text: string): TextBlock {
  return { type: "text", text };
}

function isTextBlock(block: unknown): block is TextBlock {
  return isObject(block) && block.type === "text" && typeof block.text === "string";
}

function isTextBearingBlock(block: unknown): block is ContentBlock & { text: string } {
  return isObject(block) && typeof block.text === "string";
}

function stripControlCharacters(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point.
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function stripAnsiEscapeCodes(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function stripMarkdownImages(text: string): string {
  return text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "");
}

/**
 * Truncate to at most `max` UTF-16 code units without splitting a surrogate
 * pair (which would emit a lone surrogate — an invalid Unicode payload).
 */
function truncateUtf16Safe(text: string, max: number): string {
  if (max <= 0) {
    return "";
  }
  const lastCode = text.charCodeAt(max - 1);
  const cutsSurrogatePair = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return text.slice(0, cutsSurrogatePair ? max - 1 : max);
}

function limitTextBlockLength(block: ContentBlock, maxTextLength: number | null): ContentBlock {
  if (!isTextBlock(block)) {
    return block;
  }

  if (maxTextLength === null || !Number.isFinite(maxTextLength) || maxTextLength < 0) {
    return block;
  }

  if (block.text.length <= maxTextLength) {
    return block;
  }

  return {
    ...block,
    text: truncateUtf16Safe(block.text, maxTextLength),
  };
}

/**
 * Merge consecutive text blocks into a single text block.
 * Preserves non-text block boundaries.
 */
export function mergeAdjacentTextBlocks(blocks: ContentBlock[], separator = "\n"): ContentBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [];
  }

  const merged: ContentBlock[] = [];

  for (const block of blocks) {
    const previous = merged[merged.length - 1];

    if (isTextBlock(previous) && isTextBlock(block)) {
      // `previous` is always a copy we own (see the push below), so appending
      // here never mutates a caller-supplied block.
      previous.text = `${previous.text}${separator}${block.text}`;
      continue;
    }

    // Copy text blocks before pushing so a later merge can't mutate the input.
    merged.push(isTextBlock(block) ? { ...block } : block);
  }

  return merged;
}

/**
 * Remove text blocks whose text value is empty/whitespace-only.
 * Non-text blocks are preserved as-is.
 */
export function removeEmptyTextBlocks(blocks: unknown): ContentBlock[] {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.filter((block): boolean => {
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
 */
export function normalizeContentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return [toTextBlock(content)];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const normalized: ContentBlock[] = [];

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

function normalizeProviderContentBlock(provider: string, block: ContentBlock): ContentBlock {
  if (!isObject(block)) {
    return block;
  }

  if (provider === "openai" && block.type === "input_text" && typeof block.text === "string") {
    return { ...block, type: "text" };
  }

  if (
    provider === "anthropic" &&
    block.type === "image_url" &&
    typeof block.image_url === "string"
  ) {
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
 * Register a preflight hook. Use provider `"*"` to apply globally.
 */
export function registerPreflightGuard(provider: string, hook: PreflightHook): void {
  const providerKey = provider || DEFAULT_PROVIDER;

  const existing = preflightGuardHooks.get(providerKey);
  if (existing) {
    existing.push(hook);
    return;
  }

  preflightGuardHooks.set(providerKey, [hook]);
}

/**
 * Remove all registered hooks. Useful for deterministic test setup.
 */
export function clearPreflightGuards(): void {
  preflightGuardHooks.clear();
  preflightGuardHooks.set(DEFAULT_PROVIDER, []);
}

function applyTextTransforms(text: string, options: SanitizeOptions): string {
  let next = text;
  if (options.trimMergedText === true) {
    next = next.trim();
  }
  if (options.collapseMergedWhitespace === true) {
    next = next.replace(/\s+/g, " ").trim();
  }
  if (options.stripControlChars === true) {
    next = stripControlCharacters(next);
  }
  if (options.stripAnsiEscapes === true) {
    next = stripAnsiEscapeCodes(next);
  }
  if (options.stripHtmlTags === true) {
    next = stripHtmlTags(next);
  }
  // Images must be stripped before links: an image `![alt](url)` contains the
  // link pattern `[alt](url)`, so stripping links first would leave `!alt`.
  if (options.stripMarkdownImages === true) {
    next = stripMarkdownImages(next);
  }
  if (options.stripMarkdownLinks === true) {
    next = stripMarkdownLinks(next);
  }
  return next;
}

function resolveMaxTextLength(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : null;
}

function resolveMaxBlockCount(value: number | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? Number(value) : null;
}

function resolveAggregateLimit(value: number | undefined): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? Number(value) : null;
}

function hasAggregateLimits(options: SanitizeOptions): boolean {
  return (
    resolveAggregateLimit(options.maxMessageCount) !== null ||
    resolveAggregateLimit(options.maxTotalBlockCount) !== null ||
    resolveAggregateLimit(options.maxTotalTextChars) !== null
  );
}

interface AggregateBudget {
  remainingBlocks: number | null;
  remainingTextChars: number | null;
  inputTruncated: boolean;
}

function createAggregateBudget(options: SanitizeOptions): AggregateBudget {
  return {
    remainingBlocks: resolveAggregateLimit(options.maxTotalBlockCount),
    remainingTextChars: resolveAggregateLimit(options.maxTotalTextChars),
    inputTruncated: false,
  };
}

interface MergeTextBudget {
  remainingTextChars: number | null;
}

function createMergeTextBudget(options: SanitizeOptions): MergeTextBudget {
  return {
    remainingTextChars: resolveAggregateLimit(options.maxTotalTextChars),
  };
}

function takeMergeText(text: string, budget: MergeTextBudget): string {
  if (budget.remainingTextChars === null) {
    return text;
  }

  const next =
    text.length <= budget.remainingTextChars
      ? text
      : truncateUtf16Safe(text, budget.remainingTextChars);
  budget.remainingTextChars -= next.length;
  return next;
}

function mergeAdjacentTextBlocksWithinBudget(
  blocks: ContentBlock[],
  separator: string,
  budget: MergeTextBudget,
): ContentBlock[] {
  if (budget.remainingTextChars === null) {
    return mergeAdjacentTextBlocks(blocks, separator);
  }

  const merged: ContentBlock[] = [];
  let pendingTextBlock: ContentBlock | undefined;
  let pendingTextParts: string[] = [];
  const flushPendingText = (): void => {
    if (pendingTextBlock !== undefined) {
      merged.push({ ...pendingTextBlock, text: pendingTextParts.join("") });
      pendingTextBlock = undefined;
      pendingTextParts = [];
    }
  };

  for (const block of blocks) {
    if (!isTextBlock(block)) {
      flushPendingText();
      merged.push(block);
      continue;
    }

    if (pendingTextBlock !== undefined) {
      const boundedSeparator = takeMergeText(separator, budget);
      const boundedText = takeMergeText(block.text, budget);
      if (boundedSeparator.length > 0) {
        pendingTextParts.push(boundedSeparator);
      }
      if (boundedText.length > 0) {
        pendingTextParts.push(boundedText);
      }
      continue;
    }

    const boundedText = takeMergeText(block.text, budget);
    if (boundedText.length > 0) {
      pendingTextBlock = block;
      pendingTextParts = [boundedText];
    }
  }
  flushPendingText();
  return merged;
}

const SKIP_CONTENT_ENTRY = Symbol("skip-content-entry");

function consumeInputBlock(budget: AggregateBudget): boolean {
  if (budget.remainingBlocks === 0) {
    budget.inputTruncated = true;
    return false;
  }
  if (budget.remainingBlocks !== null) {
    budget.remainingBlocks -= 1;
  }
  return true;
}

function capInputText(text: string, budget: AggregateBudget): string {
  if (budget.remainingTextChars === null) {
    return text;
  }

  const capped =
    text.length <= budget.remainingTextChars
      ? text
      : truncateUtf16Safe(text, budget.remainingTextChars);
  if (capped.length !== text.length) {
    budget.inputTruncated = true;
  }
  budget.remainingTextChars -= capped.length;
  return capped;
}

function capInputContentEntry(
  entry: unknown,
  budget: AggregateBudget,
): unknown | typeof SKIP_CONTENT_ENTRY {
  if (typeof entry === "string") {
    const text = capInputText(entry, budget);
    return text.length > 0 ? text : SKIP_CONTENT_ENTRY;
  }

  if (!isObject(entry)) {
    return entry;
  }

  const textKey =
    typeof entry.text === "string"
      ? "text"
      : entry.type === "text" && typeof entry.content === "string"
        ? "content"
        : null;
  if (textKey === null || budget.remainingTextChars === null) {
    return entry;
  }

  const originalText = entry[textKey] as string;
  const text = capInputText(originalText, budget);
  if (text.length === 0) {
    return SKIP_CONTENT_ENTRY;
  }
  return text === originalText ? entry : { ...entry, [textKey]: text };
}

function capInputContentToAggregateBudget(content: unknown, budget: AggregateBudget): unknown {
  if (budget.remainingBlocks === null && budget.remainingTextChars === null) {
    return content;
  }

  if (typeof content === "string") {
    if (!consumeInputBlock(budget)) {
      return [];
    }
    const entry = capInputContentEntry(content, budget);
    return entry === SKIP_CONTENT_ENTRY ? [] : entry;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const capped: unknown[] = [];
  for (let index = 0; index < content.length; index += 1) {
    if (!consumeInputBlock(budget)) {
      break;
    }
    const entry = content[index];
    const next = capInputContentEntry(entry, budget);
    if (next !== SKIP_CONTENT_ENTRY) {
      capped.push(next);
    }
  }
  return capped;
}

function capInputMessagesToAggregateBudget(
  messages: unknown,
  options: SanitizeOptions,
  budget: AggregateBudget,
): unknown {
  if (!Array.isArray(messages)) {
    return messages;
  }

  const maxMessageCount = resolveAggregateLimit(options.maxMessageCount);
  if (maxMessageCount !== null && messages.length > maxMessageCount) {
    budget.inputTruncated = true;
  }
  const prefix = maxMessageCount === null ? messages : messages.slice(0, maxMessageCount);
  if (budget.remainingBlocks === null && budget.remainingTextChars === null) {
    return prefix;
  }

  return prefix.map((message) =>
    isObject(message)
      ? {
          ...message,
          content: capInputContentToAggregateBudget(message.content, budget),
        }
      : message,
  );
}

function capBlocksToAggregateBudget(
  blocks: readonly ContentBlock[],
  budget: AggregateBudget,
): ContentBlock[] {
  if (budget.remainingBlocks === null && budget.remainingTextChars === null) {
    return blocks as ContentBlock[];
  }

  const capped: ContentBlock[] = [];

  for (const block of blocks) {
    if (budget.remainingBlocks === 0) {
      break;
    }

    if (!isTextBearingBlock(block)) {
      capped.push(block);
      if (budget.remainingBlocks !== null) {
        budget.remainingBlocks -= 1;
      }
      continue;
    }

    if (budget.remainingTextChars === null) {
      capped.push(block);
      if (budget.remainingBlocks !== null) {
        budget.remainingBlocks -= 1;
      }
      continue;
    }

    const text =
      block.text.length <= budget.remainingTextChars
        ? block.text
        : truncateUtf16Safe(block.text, budget.remainingTextChars);

    // A text block that cannot emit any text consumes neither a block nor text
    // budget, so a later non-text block can still be retained.
    if (text.length === 0) {
      continue;
    }

    capped.push(text === block.text ? block : { ...block, text });
    budget.remainingTextChars -= text.length;
    if (budget.remainingBlocks !== null) {
      budget.remainingBlocks -= 1;
    }
  }

  return capped;
}

function capMessagePrefix(
  messages: SanitizedMessage[],
  maxMessageCount: number | null,
): SanitizedMessage[] {
  return maxMessageCount === null ? messages : messages.slice(0, maxMessageCount);
}

function capMessagesToAggregateBudget(
  messages: readonly SanitizedMessage[],
  budget: AggregateBudget,
  keepEmptyMessages: boolean,
): SanitizedMessage[] {
  const capped = messages.map(
    (message): SanitizedMessage => ({
      ...message,
      content: capBlocksToAggregateBudget(
        Array.isArray(message.content) ? message.content : [],
        budget,
      ),
    }),
  );

  return keepEmptyMessages ? capped : capped.filter((message) => message.content.length > 0);
}

function applyMessageAggregateLimits(
  messages: SanitizedMessage[],
  options: SanitizeOptions,
): SanitizedMessage[] {
  const maxMessageCount = resolveAggregateLimit(options.maxMessageCount);
  const budget = createAggregateBudget(options);
  if (
    maxMessageCount === null &&
    budget.remainingBlocks === null &&
    budget.remainingTextChars === null
  ) {
    return messages;
  }

  const prefixed = capMessagePrefix(messages, maxMessageCount);
  return capMessagesToAggregateBudget(prefixed, budget, options.keepEmptyMessages === true);
}

/**
 * Normalize message arrays before applying aggregate message/block/text caps.
 * - keeps role when provided
 * - normalizes each message.content through block normalization
 * - removes messages whose normalized content is empty (unless kept)
 */
function normalizeMessages(
  messages: unknown,
  options: SanitizeOptions = {},
  mergeBudget: MergeTextBudget = createMergeTextBudget(options),
): SanitizedMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const keepEmptyMessages = options.keepEmptyMessages === true;
  const provider = options.provider || DEFAULT_PROVIDER;
  const profileMode = options.profileMode || "basic";

  const mergeAdjacentText = options.mergeAdjacentText === true;
  const mergeSeparator = typeof options.mergeSeparator === "string" ? options.mergeSeparator : "\n";
  const maxTextLength = resolveMaxTextLength(options.maxTextLength);
  const maxBlockCount = resolveMaxBlockCount(options.maxBlockCount);

  const normalizedMessages = messages
    .filter((message): message is Record<string, unknown> => isObject(message))
    .map((message): SanitizedMessage => {
      const normalizedContent = removeEmptyTextBlocks(normalizeContentBlocks(message.content)).map(
        (block) => (profileMode === "off" ? block : normalizeProviderContentBlock(provider, block)),
      );

      const mergedContent = mergeAdjacentText
        ? mergeAdjacentTextBlocksWithinBudget(normalizedContent, mergeSeparator, mergeBudget)
        : normalizedContent;

      const normalizedMergedContent = mergedContent.map((block): ContentBlock => {
        if (!isTextBlock(block)) {
          return block;
        }

        const text = applyTextTransforms(block.text, options);
        return limitTextBlockLength({ ...block, text }, maxTextLength);
      });

      const normalizedMergedWithoutEmpty = removeEmptyTextBlocks(normalizedMergedContent);
      const normalizedCappedContent =
        maxBlockCount !== null
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

  return normalizedMessages.filter(
    (message) => Array.isArray(message.content) && message.content.length > 0,
  );
}

/**
 * Normalize message arrays into a safe, provider-friendly shape, then apply
 * deterministic aggregate limits in message/block order.
 */
export function sanitizeMessages(
  messages: unknown,
  options: SanitizeOptions = {},
): SanitizedMessage[] {
  const inputBudget = createAggregateBudget(options);
  const cappedInput = capInputMessagesToAggregateBudget(messages, options, inputBudget);
  const mergeBudget = createMergeTextBudget(options);
  return applyMessageAggregateLimits(normalizeMessages(cappedInput, options, mergeBudget), options);
}

function countRoles(messages: unknown): Record<string, number> {
  if (!Array.isArray(messages)) {
    return {};
  }

  return messages.reduce<Record<string, number>>((acc, message) => {
    const key =
      isObject(message) && typeof message.role === "string" && message.role.trim().length > 0
        ? message.role
        : "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function countTextChars(messages: unknown): number {
  if (!Array.isArray(messages)) {
    return 0;
  }

  return messages.reduce<number>((acc, message) => {
    const blocks = normalizeContentBlocks(isObject(message) ? message.content : undefined);
    const textChars = blocks.reduce<number>((sum, block) => {
      if (!isTextBearingBlock(block)) {
        return sum;
      }
      return sum + block.text.length;
    }, 0);
    return acc + textChars;
  }, 0);
}

function countBlockTextChars(blocks: ContentBlock[]): number {
  return blocks.reduce<number>((acc, block) => {
    if (!isTextBearingBlock(block)) {
      return acc;
    }
    return acc + block.text.length;
  }, 0);
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? Number((part / whole).toFixed(3)) : 0;
}

/**
 * Summarize sanitize impact for observability/debug UX.
 */
export function summarizeSanitizeImpact(
  originalMessages: unknown,
  sanitizedMessages: unknown,
): SanitizeImpact {
  const inputMessages = Array.isArray(originalMessages) ? originalMessages.length : 0;
  const outputMessages = Array.isArray(sanitizedMessages) ? sanitizedMessages.length : 0;
  const removedMessages = Math.max(0, inputMessages - outputMessages);

  const inputBlocks = Array.isArray(originalMessages)
    ? originalMessages.reduce<number>(
        (acc, msg) => acc + normalizeContentBlocks(isObject(msg) ? msg.content : undefined).length,
        0,
      )
    : 0;
  const outputBlocks = Array.isArray(sanitizedMessages)
    ? sanitizedMessages.reduce<number>(
        (acc, msg) => acc + (isObject(msg) && Array.isArray(msg.content) ? msg.content.length : 0),
        0,
      )
    : 0;
  const removedBlocks = Math.max(0, inputBlocks - outputBlocks);

  const inputTextChars = countTextChars(originalMessages);
  const outputTextChars = countTextChars(sanitizedMessages);
  const removedTextChars = Math.max(0, inputTextChars - outputTextChars);

  return {
    inputMessages,
    outputMessages,
    removedMessages,
    removedMessageRatio: ratio(removedMessages, inputMessages),
    inputBlocks,
    outputBlocks,
    removedBlocks,
    removedBlockRatio: ratio(removedBlocks, inputBlocks),
    inputTextChars,
    outputTextChars,
    removedTextChars,
    removedTextCharRatio: ratio(removedTextChars, inputTextChars),
    inputRoles: countRoles(originalMessages),
    outputRoles: countRoles(sanitizedMessages),
  };
}

/**
 * Summarize full payload sanitize impact, including top-level content blocks.
 */
export function summarizePayloadImpact(
  originalPayload: unknown,
  sanitizedPayload: unknown,
): PayloadImpact {
  const originalContent = isObject(originalPayload) ? originalPayload.content : undefined;
  const sanitizedContent = isObject(sanitizedPayload) ? sanitizedPayload.content : undefined;
  const originalMessages = isObject(originalPayload) ? originalPayload.messages : undefined;
  const sanitizedMessages = isObject(sanitizedPayload) ? sanitizedPayload.messages : undefined;

  const inputContent = normalizeContentBlocks(originalContent);
  const outputContent = Array.isArray(sanitizedContent) ? (sanitizedContent as ContentBlock[]) : [];
  const inputContentBlocks = inputContent.length;
  const outputContentBlocks = outputContent.length;

  const messageImpact = summarizeSanitizeImpact(originalMessages, sanitizedMessages);

  const removedRoles = Object.keys(messageImpact.inputRoles).filter(
    (role) => (messageImpact.inputRoles[role] || 0) > (messageImpact.outputRoles[role] || 0),
  );

  const inputContentTextChars = countBlockTextChars(inputContent);
  const outputContentTextChars = countBlockTextChars(outputContent);

  const removedContentBlocks = Math.max(0, inputContentBlocks - outputContentBlocks);
  const removedContentTextChars = Math.max(0, inputContentTextChars - outputContentTextChars);

  const inputTotalBlocks = messageImpact.inputBlocks + inputContentBlocks;
  const outputTotalBlocks = messageImpact.outputBlocks + outputContentBlocks;
  const removedTotalBlocks = Math.max(0, inputTotalBlocks - outputTotalBlocks);

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
    removedContentBlockRatio: ratio(removedContentBlocks, inputContentBlocks),
    inputContentTextChars,
    outputContentTextChars,
    removedContentTextChars,
    removedContentTextCharRatio: ratio(removedContentTextChars, inputContentTextChars),
    inputTotalBlocks,
    outputTotalBlocks,
    removedTotalBlocks,
    removedTotalBlockRatio: ratio(removedTotalBlocks, inputTotalBlocks),
    inputTotalTextChars,
    outputTotalTextChars,
    removedTotalTextChars,
    removedTotalTextCharRatio: ratio(removedTotalTextChars, inputTotalTextChars),
  };
}

function applyPayloadAggregateLimits(
  payload: SanitizedPayload,
  options: SanitizeOptions,
): SanitizedPayload {
  const maxMessageCount = resolveAggregateLimit(options.maxMessageCount);
  const budget = createAggregateBudget(options);

  if (
    maxMessageCount === null &&
    budget.remainingBlocks === null &&
    budget.remainingTextChars === null
  ) {
    return payload;
  }

  const hasMessages = Object.hasOwn(payload, "messages");
  const prefixedMessages = hasMessages
    ? capMessagePrefix(
        Array.isArray(payload.messages)
          ? payload.messages.filter((message): message is SanitizedMessage => isObject(message))
          : [],
        maxMessageCount,
      )
    : undefined;
  const content = capBlocksToAggregateBudget(
    Array.isArray(payload.content) ? payload.content : [],
    budget,
  );
  const messages =
    prefixedMessages === undefined
      ? undefined
      : capMessagesToAggregateBudget(prefixedMessages, budget, options.keepEmptyMessages === true);

  const capped: SanitizedPayload = {
    ...payload,
    content,
  };
  if (messages !== undefined) {
    capped.messages = messages;
  }
  return capped;
}

/**
 * Run preflight sanitization plus provider/global hooks.
 */
export function runPreflightGuards(
  payload: unknown,
  options: PreflightOptions = {},
): SanitizedPayload {
  const provider = options.provider || DEFAULT_PROVIDER;
  const profileMode = options.profileMode || "basic";
  const maxTextLength = resolveMaxTextLength(options.maxTextLength);
  const maxBlockCount = resolveMaxBlockCount(options.maxBlockCount);

  const payloadObject = isObject(payload) ? payload : {};

  // Gate raw content before regex transforms and merging so configured limits
  // bound sanitizer work as well as the returned normalized output.
  const inputBudget = createAggregateBudget(options);
  const cappedTopLevelInput = capInputContentToAggregateBudget(payloadObject.content, inputBudget);
  const cappedMessagesInput = capInputMessagesToAggregateBudget(
    payloadObject.messages,
    options,
    inputBudget,
  );
  const mergeBudget = createMergeTextBudget(options);

  const normalizedTopLevelContent = removeEmptyTextBlocks(
    normalizeContentBlocks(cappedTopLevelInput),
  ).map((block) =>
    profileMode === "off" ? block : normalizeProviderContentBlock(provider, block),
  );

  const mergedTopLevelContent =
    options.mergeAdjacentText === true
      ? mergeAdjacentTextBlocksWithinBudget(
          normalizedTopLevelContent,
          typeof options.mergeSeparator === "string" ? options.mergeSeparator : "\n",
          mergeBudget,
        )
      : normalizedTopLevelContent;

  const normalizedTopLevelMergedContent = removeEmptyTextBlocks(
    mergedTopLevelContent.map((block): ContentBlock => {
      if (!isTextBlock(block)) {
        return block;
      }

      const text = applyTextTransforms(block.text, options);
      return limitTextBlockLength({ ...block, text }, maxTextLength);
    }),
  );

  const normalizedTopLevelCappedContent =
    maxBlockCount !== null
      ? normalizedTopLevelMergedContent.slice(0, maxBlockCount)
      : normalizedTopLevelMergedContent;
  const messages = normalizeMessages(cappedMessagesInput, options, mergeBudget);

  let sanitized: SanitizedPayload = applyPayloadAggregateLimits(
    {
      ...payloadObject,
      content: normalizedTopLevelCappedContent,
      messages,
    },
    options,
  );

  const impactSource = hasAggregateLimits(options)
    ? { content: cappedTopLevelInput, messages: cappedMessagesInput }
    : payloadObject;
  const updateImpact = (): void => {
    if (options.includeImpact !== true) {
      return;
    }
    const impact = summarizePayloadImpact(impactSource, sanitized);
    if (inputBudget.inputTruncated) {
      impact.inputMetricsTruncated = true;
    }
    sanitized.sanitizeImpact = impact;
  };
  updateImpact();

  // Global (`*`) hooks always run; provider-specific hooks run after them.
  // When no provider is given, `provider` IS `DEFAULT_PROVIDER`, so guard
  // against running the global hooks twice.
  const globalHooks = preflightGuardHooks.get(DEFAULT_PROVIDER) || [];
  const providerHooks =
    provider === DEFAULT_PROVIDER ? [] : preflightGuardHooks.get(provider) || [];
  const hooks: PreflightHook[] = [...globalHooks, ...providerHooks];

  for (const hook of hooks) {
    const next = hook({ provider, payload: sanitized });
    if (isObject(next) && Array.isArray(next.content)) {
      sanitized = next as SanitizedPayload;
    }

    // Hooks are expected to return replacements, but cap after every invocation
    // so an in-place mutation that returns nothing cannot inflate what the next
    // hook observes.
    sanitized = applyPayloadAggregateLimits(sanitized, options);
    updateImpact();
  }

  // Reapply once at the boundary as defense in depth for hooks that mutate the
  // payload in place but return nothing.
  sanitized = applyPayloadAggregateLimits(sanitized, options);
  updateImpact();

  return sanitized;
}
