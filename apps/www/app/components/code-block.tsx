/**
 * Syntax-highlighted code block using Shiki
 *
 * Pre-renders code at module load time for static examples
 */
import { Effect, Schema } from "effect";
import {
  Component,
  Portal,
  Signal,
  type ComponentProps,
  type Element as TryggElement,
} from "trygg";

import { getTheme, type Theme } from "../lib/theme";
import {
  createDocsHighlighter,
  highlightToLines,
  isHastNode,
  normalizeLanguage,
  type HastNode,
  type HighlightedLine,
} from "../lib/shiki-highlight";

// Re-export so existing importers (docs-article, tabs, changelog-detail) keep
// resolving HighlightedLine from this module.
export type { HighlightedLine };

class HighlightCodeError extends Schema.TaggedErrorClass<HighlightCodeError>()(
  "HighlightCodeError",
  {
    cause: Schema.Unknown,
  },
) {}

export interface IdentifierTooltip {
  readonly kind: string;
  readonly description: string;
  readonly signature?: string;
  readonly asProperty?: IdentifierTooltip;
}

export type IdentifierTooltipMap = Readonly<Record<string, IdentifierTooltip>>;

export interface RenderTracker {
  precedingChar: string | undefined;
  seen: Set<string>;
}

export const createRenderTracker = (): RenderTracker => ({
  precedingChar: undefined,
  seen: new Set<string>(),
});

export interface HastRenderOptions {
  readonly tooltips?: IdentifierTooltipMap;
  readonly tooltipIdPrefix?: string;
  readonly tracker?: RenderTracker;
}

export function hastNodeText(node: HastNode): string {
  if (node.type === "text") return node.value;
  return (node.children ?? []).filter(isHastNode).map(hastNodeText).join("");
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const positionTip = (trigger: HTMLElement, tip: HTMLElement) => {
  // For wrapped inline elements, getBoundingClientRect returns the union box of
  // every line fragment; left/top reflect the leftmost wrapped piece, not where
  // the identifier visually starts. getClientRects()[0] is the first line's
  // rect, which is what the underline is drawn beneath.
  const rects = trigger.getClientRects();
  const triggerRect = rects.length > 0 ? rects[0] : trigger.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const gap = 10;
  const edge = 8;

  let top = triggerRect.top - tipRect.height - gap;
  if (top < edge) {
    top = triggerRect.bottom + gap;
  }

  const maxLeft = window.innerWidth - tipRect.width - edge;
  let left = triggerRect.left;
  if (left > maxLeft) left = Math.max(edge, maxLeft);
  if (left < edge) left = edge;

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
};

const closeTimers = new Map<string, number>();
// Counts active "show" sources per tooltip id (pointer hover, keyboard focus,
// pointer over the tooltip itself). The tip stays visible whenever count > 0.
const sourceCounts = new Map<string, number>();

const incrementSource = (id: string) => {
  sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
};
const decrementSource = (id: string) => {
  sourceCounts.set(id, Math.max(0, (sourceCounts.get(id) ?? 0) - 1));
};

const showTipNow = (tip: HTMLElement, trigger: HTMLElement) => {
  const pending = closeTimers.get(tip.id);
  if (pending !== undefined) {
    clearTimeout(pending);
    closeTimers.delete(tip.id);
  }
  tip.setAttribute("data-show", "true");
  positionTip(trigger, tip);
};

const hideTipNow = (tip: HTMLElement) => {
  const pending = closeTimers.get(tip.id);
  if (pending !== undefined) {
    clearTimeout(pending);
    closeTimers.delete(tip.id);
  }
  tip.setAttribute("data-show", "false");
};

const scheduleHide = (tip: HTMLElement) => {
  const pending = closeTimers.get(tip.id);
  if (pending !== undefined) clearTimeout(pending);
  const handle = window.setTimeout(() => {
    tip.setAttribute("data-show", "false");
    closeTimers.delete(tip.id);
  }, 140);
  closeTimers.set(tip.id, handle);
};

const refreshTip = (tip: HTMLElement, trigger: HTMLElement, immediate = false) => {
  const count = sourceCounts.get(tip.id) ?? 0;
  if (count > 0) {
    showTipNow(tip, trigger);
  } else if (immediate) {
    hideTipNow(tip);
  } else {
    scheduleHide(tip);
  }
};

const currentTargetElement = (event: Event): HTMLElement | null =>
  event.currentTarget instanceof HTMLElement ? event.currentTarget : null;

const onTokenActivate = (event: Event) =>
  Effect.sync(() => {
    const trigger = currentTargetElement(event);
    if (trigger === null) return;
    const tipId = trigger.getAttribute("aria-describedby");
    if (!tipId) return;
    const tip = document.getElementById(tipId);
    if (!tip) return;
    incrementSource(tipId);
    refreshTip(tip, trigger);
  });

const onTokenDeactivate = (event: Event) =>
  Effect.sync(() => {
    const trigger = currentTargetElement(event);
    if (trigger === null) return;
    const tipId = trigger.getAttribute("aria-describedby");
    if (!tipId) return;
    const tip = document.getElementById(tipId);
    if (!tip) return;
    decrementSource(tipId);
    refreshTip(tip, trigger);
  });

const onTokenKeyDown = (event: Event) =>
  Effect.sync(() => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Escape") return;
    const trigger = currentTargetElement(event);
    if (trigger === null) return;
    const tipId = trigger.getAttribute("aria-describedby");
    if (!tipId) return;
    const tip = document.getElementById(tipId);
    if (!tip) return;
    if ((sourceCounts.get(tipId) ?? 0) === 0) return;
    // WCAG 1.4.13 dismissable: clear all sources, hide immediately, focus stays.
    // Re-show requires a new event (blur + focus, or fresh hover).
    sourceCounts.set(tipId, 0);
    hideTipNow(tip);
    event.preventDefault();
  });

const onTipActivate = (event: Event) =>
  Effect.sync(() => {
    const tip = currentTargetElement(event);
    if (tip === null) return;
    const trigger = document.querySelector<HTMLElement>(`[aria-describedby="${tip.id}"]`);
    if (!trigger) return;
    incrementSource(tip.id);
    refreshTip(tip, trigger);
  });

const onTipDeactivate = (event: Event) =>
  Effect.sync(() => {
    const tip = currentTargetElement(event);
    if (tip === null) return;
    const trigger = document.querySelector<HTMLElement>(`[aria-describedby="${tip.id}"]`);
    if (!trigger) return;
    decrementSource(tip.id);
    refreshTip(tip, trigger);
  });

interface TooltipTokenProps {
  readonly text: string;
  readonly tokenKey: string;
  readonly tooltip: IdentifierTooltip;
  readonly tipId: string;
}

const TooltipToken = Component.gen(function* (Props: ComponentProps<TooltipTokenProps>) {
  const { text, tokenKey, tooltip, tipId } = yield* Props;

  const TipPortal = yield* Portal.make(
    <span
      id={tipId}
      className="code-token__tip"
      role="tooltip"
      data-show="false"
      onMouseEnter={onTipActivate}
      onMouseLeave={onTipDeactivate}
    >
      <span className="code-token__tip-head">
        <strong>{tokenKey}</strong>
        <span className="code-token__tip-kind">{tooltip.kind}</span>
      </span>
      <span className="code-token__tip-body">{tooltip.description}</span>
      {tooltip.signature ? <code className="code-token__tip-sig">{tooltip.signature}</code> : null}
    </span>,
  );

  return (
    <span className="code-token">
      <span
        className="code-token__name"
        aria-describedby={tipId}
        data-token={tokenKey}
        tabIndex={0}
        onMouseEnter={onTokenActivate}
        onMouseLeave={onTokenDeactivate}
        onFocus={onTokenActivate}
        onBlur={onTokenDeactivate}
        onKeyDown={onTokenKeyDown}
      >
        {text}
      </span>
      <TipPortal />
    </span>
  );
});

function renderTooltipPart(
  text: string,
  tokenKey: string,
  tooltip: IdentifierTooltip,
  prefix: string,
  parentKey: number,
  index: number,
) {
  const tipId = `${prefix}-${tokenKey.toLowerCase()}-${parentKey}-${index}`;
  return (
    <TooltipToken key={index} text={text} tokenKey={tokenKey} tooltip={tooltip} tipId={tipId} />
  );
}

const advanceTracker = (tracker: RenderTracker | undefined, text: string) => {
  if (!tracker || text.length === 0) return;
  tracker.precedingChar = text[text.length - 1];
};

export function hastChildToJsx(node: HastNode, key: number, options: HastRenderOptions = {}) {
  if (node.type === "text") {
    advanceTracker(options.tracker, node.value);
    return <span key={key}>{node.value}</span>;
  }

  const { properties, children } = node;
  const style = typeof properties?.style === "string" ? properties.style : undefined;

  if (options.tooltips && children.length === 1) {
    const sole = children[0];
    if (sole?.type === "text") {
      const identMap = options.tooltips;
      const allKeys = Object.keys(identMap);
      if (allKeys.length > 0) {
        const pattern = new RegExp(`\\b(${allKeys.map(escapeRegex).join("|")})\\b`, "g");
        const text = sole.value;
        const firstChar = text.trimStart()[0];
        const isStringLiteral = firstChar === '"' || firstChar === "'" || firstChar === "`";
        // Shiki bundles JSX text with surrounding tag punctuation into a single
        // span (e.g. `>Loading users…</`). Skip identifier matching whenever
        // the span carries JSX angle brackets so prose words don't pretend to
        // be code.
        const isJsxText = text.includes("<") || text.includes(">");
        const matches = isStringLiteral || isJsxText ? [] : [...text.matchAll(pattern)];
        if (matches.length > 0) {
          const prefix = options.tooltipIdPrefix ?? "code-tip";
          const parts: Array<TryggElement> = [];
          let lastIndex = 0;
          let partIndex = 0;
          for (const m of matches) {
            const start = m.index ?? 0;
            const matched = m[0];
            const charBefore =
              start > 0
                ? text[start - 1]
                : start === 0
                  ? options.tracker?.precedingChar
                  : undefined;
            const isPropertyAccess = charBefore === ".";
            // Property accesses (e.g. `users` and `list` in `client.users.list()`)
            // are always hoverable — first-occurrence-only would hide them once
            // the bare identifier was already shown.
            if (!isPropertyAccess && options.tracker?.seen.has(matched)) continue;
            const baseTooltip = identMap[matched];
            if (!baseTooltip) continue;
            const tooltip =
              isPropertyAccess && baseTooltip.asProperty ? baseTooltip.asProperty : baseTooltip;
            if (start > lastIndex) {
              parts.push(<span key={partIndex++}>{text.slice(lastIndex, start)}</span>);
            }
            parts.push(renderTooltipPart(matched, matched, tooltip, prefix, key, partIndex++));
            lastIndex = start + matched.length;
            if (!isPropertyAccess) options.tracker?.seen.add(matched);
          }
          if (lastIndex < text.length) {
            parts.push(<span key={partIndex++}>{text.slice(lastIndex)}</span>);
          }
          advanceTracker(options.tracker, text);
          if (style) {
            return (
              <span key={key} style={parseStyle(style)}>
                {parts}
              </span>
            );
          }
          return <span key={key}>{parts}</span>;
        }
      }
    }
  }

  const childElements = children
    .filter(isHastNode)
    .map((child, i) => hastChildToJsx(child, i, options));

  if (style) {
    return (
      <span key={key} style={parseStyle(style)}>
        {childElements}
      </span>
    );
  }

  return <span key={key}>{childElements}</span>;
}

function parseStyle(styleStr: string): Record<string, string> {
  const style: Record<string, string> = {};
  styleStr.split(";").forEach((rule) => {
    const [prop, value] = rule.split(":").map((s) => s.trim());
    if (prop && value) {
      const camelProp = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      style[camelProp] = value;
    }
  });
  return style;
}

const highlightedLinesCache = new Map<string, Promise<HighlightedLine[]>>();

async function highlightCodeUncached(
  code: string,
  normalizedLang: string,
): Promise<HighlightedLine[]> {
  const hl = await createDocsHighlighter();
  return highlightToLines(hl, code, normalizedLang);
}

export function highlightCode(
  code: string,
  lang = "tsx",
  theme: Theme = getTheme(),
): Promise<HighlightedLine[]> {
  const normalizedLang = normalizeLanguage(lang);
  const cacheKey = `${theme}\u0000${normalizedLang}\u0000${code}`;
  const cached = highlightedLinesCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const highlighted = Effect.runPromise(
    Effect.tryPromise({
      try: () => highlightCodeUncached(code, normalizedLang),
      catch: (cause) => new HighlightCodeError({ cause }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          highlightedLinesCache.delete(cacheKey);
        }),
      ),
    ),
  );
  highlightedLinesCache.set(cacheKey, highlighted);
  return highlighted;
}

export const CodeBlock = Component.gen(function* (
  Props: ComponentProps<{
    lines: ReadonlyArray<HighlightedLine>;
    header?: string;
    fileType?: string;
    copyText?: string;
  }>,
) {
  const { lines, header, fileType, copyText } = yield* Props;
  const copied = yield* Signal.make(false);

  const isCommand = ["sh", "bash", "shell", "zsh", "console"].includes(
    fileType?.toLowerCase() ?? "",
  );
  const copyIdle = isCommand ? "Copy command to clipboard" : "Copy code to clipboard";
  const copyDone = isCommand ? "Command copied" : "Code copied";
  const copyLabel = yield* Signal.derive(copied, (value) =>
    value ? copyDone : copyIdle,
  );

  const CopiedTooltip = yield* Signal.derive(copied, (value) =>
    value ? (
      <span
        aria-live="polite"
        className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--color-code-elevated)] border border-[var(--color-code-rule-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-code-ink)] shadow-sm"
      >
        Copied
      </span>
    ) : (
      <></>
    ),
  );

  const dismiss = () => Signal.set(copied, false);

  const handleCopy = Effect.fnUntraced(function* (_event: Event) {
    if (!copyText) return;

    const didCopy = yield* Effect.tryPromise(() => navigator.clipboard.writeText(copyText)).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!didCopy) return;

    yield* Signal.set(copied, true);
    yield* Effect.sleep("3 seconds");
    yield* Signal.set(copied, false);
  });

  const copyIcon = (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M8 8h11v11H8z" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  );

  return (
    <figure
      className="group relative bg-[var(--color-code-bg)] border border-[var(--color-code-rule-strong)] rounded-lg overflow-hidden"
      role="figure"
      aria-label={header ? `Code example: ${header}` : "Code example"}
    >
      {header && (
        <div className="flex items-center justify-between gap-3 px-4 lg:px-5 py-2 lg:py-2.5 border-b border-[var(--color-code-rule)]">
          <span className="font-mono text-xs lg:text-sm text-[var(--color-code-ink)] truncate min-w-0">
            {header}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            {fileType && (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-code-ink-subtle)]">
                {fileType}
              </span>
            )}
            {copyText && (
              <button
                type="button"
                className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-code-ink-subtle)] transition hover:bg-[var(--color-code-elevated)] hover:text-[var(--color-code-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-code-signature)]"
                onClick={handleCopy}
                onMouseLeave={dismiss}
                aria-label={copyLabel}
              >
                {CopiedTooltip}
                {copyIcon}
              </button>
            )}
          </div>
        </div>
      )}

      {!header && (fileType || copyText) && (
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
          {fileType && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-code-ink-subtle)] bg-[var(--color-code-elevated)]/85 backdrop-blur-sm border border-[var(--color-code-rule)] rounded px-1.5 py-0.5">
              {fileType}
            </span>
          )}
          {copyText && (
            <button
              type="button"
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-code-rule)] bg-[var(--color-code-elevated)]/85 backdrop-blur-sm text-[var(--color-code-ink-subtle)] transition hover:border-[var(--color-code-rule-strong)] hover:text-[var(--color-code-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-code-signature)]"
              onClick={handleCopy}
              onMouseLeave={dismiss}
              aria-label={copyLabel}
            >
              {CopiedTooltip}
              {copyIcon}
            </button>
          )}
        </div>
      )}

      <pre
        className="relative m-0 py-3 lg:py-4 overflow-x-auto leading-relaxed text-xs lg:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-code-signature)]"
        tabIndex={0}
      >
        <code>
          {lines.map((line: HighlightedLine) => (
            <div key={line.lineNumber} className="flex px-3 lg:px-5">
              <span
                className="w-7 lg:w-10 shrink-0 text-right pr-3 lg:pr-5 text-[var(--color-code-ink-subtle)] select-none"
                aria-hidden="true"
              >
                {line.lineNumber}
              </span>
              <span className="flex-1 min-w-0">
                {line.nodes.map((node: HastNode, j: number) => hastChildToJsx(node, j))}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </figure>
  );
});
