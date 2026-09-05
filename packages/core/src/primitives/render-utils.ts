import { Effect, Equal, Option, Predicate } from "effect";
import * as Context from "effect/Context";
import * as SafeUrl from "../security/safe-url.js";
import * as Trace from "../trace/index.js";
import type { Element, ElementProps } from "./element.js";

const hasElementProp = (
  props: ElementProps,
  key: string,
): props is ElementProps & Record<string, unknown> => Object.hasOwn(props, key);

export interface BlockedSafeUrlAttribute {
  readonly key: string;
  readonly url: string;
  readonly allowedSchemes: ReadonlyArray<string>;
}

export const logBlockedSafeUrlAttribute = ({
  key,
  url,
  allowedSchemes,
}: BlockedSafeUrlAttribute): Effect.Effect<void> =>
  Trace.emit("safeUrl.blocked", () => ({
    attribute: key,
    url,
    allowed_schemes: allowedSchemes,
  }));

export const equalOrChanged = (left: unknown, right: unknown): boolean =>
  Option.match(Option.liftThrowable(Equal.equals)(left, right), {
    onNone: () => false,
    onSome: (equals) => equals,
  });

/**
 * Shallow per-key identity comparison for intrinsic prop objects.
 *
 * Props are fresh object literals produced by JSX on every render, so the
 * structural {@link Equal.equals} used by {@link equalOrChanged} pays a full
 * recursive `Hash`/structural walk over both objects only to almost always
 * report "changed" — pure overhead on the reconcile hot path (profiled at
 * ~8-11% of the keyed-list update window). Prop reconciliation only needs to
 * know whether any prop *value* changed identity: a new signal/handler/string
 * must re-bind, a same-identity value need not. `Object.is` per key answers
 * exactly that, in linear time with no hashing.
 *
 * Object-valued props (e.g. an inline `style={{...}}` literal) compare by
 * reference, so a structurally-equal but freshly-allocated object reports
 * "changed" and is re-applied. That is harmless: prop application is idempotent.
 *
 * Returns `true` when every prop is identity-equal (reconcile may skip
 * re-application), `false` when any prop differs.
 */
export const shallowPropsEqual = (left: ElementProps, right: ElementProps): boolean => {
  if (left === right) return true;
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  for (const [key, leftValue] of leftEntries) {
    if (!hasElementProp(right, key) || !Object.is(leftValue, right[key])) {
      return false;
    }
  }
  return true;
};

export const resolveReconcileTarget = (
  element: Element,
  context: Context.Context<unknown> | null,
): { readonly element: Element; readonly context: Context.Context<unknown> | null } => {
  let currentElement: Element = element;
  let currentContext = context;

  while (Predicate.isTagged(currentElement, "Provide")) {
    currentContext =
      currentContext !== null
        ? Context.merge(currentContext, currentElement.context)
        : currentElement.context;
    currentElement = currentElement.child;
  }

  return { element: currentElement, context: currentContext };
};

/**
 * Apply a single prop value to a DOM element.
 * @internal
 */
export const clearPropValue = (node: globalThis.Element, key: string): void => {
  if (key === "children" || key === "key" || key.startsWith("on")) return;

  if (key === "style") {
    node.removeAttribute("style");
  } else if (key === "className") {
    node.removeAttribute("class");
  } else if (key === "htmlFor") {
    node.removeAttribute("for");
  } else if (key === "checked" && node instanceof HTMLInputElement) {
    node.checked = false;
  } else if (
    key === "value" &&
    (node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement)
  ) {
    node.value = "";
  } else {
    node.removeAttribute(key);
  }
};

const isAsciiWhitespace = (character: string): boolean =>
  character === "\t" ||
  character === "\n" ||
  character === "\f" ||
  character === "\r" ||
  character === " ";

// Extract candidate URLs using the delimiter rules from the HTML srcset
// algorithm. Commas inside a URL (notably data URLs) are preserved.
const srcSetUrls = (value: string): ReadonlyArray<string> => {
  const urls: Array<string> = [];
  let position = 0;

  while (position < value.length) {
    while (
      position < value.length &&
      (isAsciiWhitespace(value[position] ?? "") || value[position] === ",")
    ) {
      position++;
    }
    if (position >= value.length) break;

    const urlStart = position;
    while (position < value.length && !isAsciiWhitespace(value[position] ?? "")) {
      position++;
    }

    let url = value.slice(urlStart, position);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (url !== "") urls.push(url);
      continue;
    }

    let inParentheses = false;
    while (position < value.length) {
      const character = value[position];
      position++;
      if (!inParentheses && character === "(") {
        inParentheses = true;
      } else if (inParentheses && character === ")") {
        // HTML's tokenizer has no nesting depth: the first ')' returns to the
        // descriptor state, where a following comma starts the next candidate.
        inParentheses = false;
      } else if (!inParentheses && character === ",") {
        break;
      }
    }
    if (url !== "") urls.push(url);
  }

  return urls;
};

const spaceSeparatedUrls = (value: string): ReadonlyArray<string> =>
  value.split(/[\t\n\f\r ]+/).filter((candidate) => candidate !== "");

type UrlAttributeGrammar = "single" | "srcset" | "space-separated";

interface UrlAttributePolicy {
  readonly sink: SafeUrl.UrlSink;
  readonly grammar: UrlAttributeGrammar;
}

interface UrlAttributeRule {
  readonly fallback: UrlAttributePolicy;
  readonly elements: Readonly<Record<string, UrlAttributePolicy>>;
}

const NAVIGATION_URL: UrlAttributePolicy = { sink: "navigation", grammar: "single" };
const FORM_URL: UrlAttributePolicy = { sink: "form", grammar: "single" };
const RESOURCE_URL: UrlAttributePolicy = { sink: "resource", grammar: "single" };
const IMAGE_URL: UrlAttributePolicy = { sink: "image", grammar: "single" };
const MEDIA_URL: UrlAttributePolicy = { sink: "media", grammar: "single" };
const IMAGE_SRCSET: UrlAttributePolicy = { sink: "image", grammar: "srcset" };
const RESOURCE_URL_LIST: UrlAttributePolicy = {
  sink: "resource",
  grammar: "space-separated",
};

// Every URL-bearing prop exposed by Element types is owned here. The fallback
// prevents invalid element/attribute combinations from reaching generic DOM
// assignment, while element overrides grant only the capability that sink needs.
const URL_ATTRIBUTE_RULES: Readonly<Record<string, UrlAttributeRule>> = {
  action: { fallback: FORM_URL, elements: { form: FORM_URL } },
  cite: {
    fallback: RESOURCE_URL,
    elements: {
      blockquote: RESOURCE_URL,
      del: RESOURCE_URL,
      ins: RESOURCE_URL,
      q: RESOURCE_URL,
    },
  },
  data: { fallback: RESOURCE_URL, elements: { object: RESOURCE_URL } },
  formaction: {
    fallback: FORM_URL,
    elements: { button: FORM_URL, input: FORM_URL },
  },
  href: {
    fallback: RESOURCE_URL,
    elements: {
      a: NAVIGATION_URL,
      area: NAVIGATION_URL,
      base: RESOURCE_URL,
      image: IMAGE_URL,
      link: RESOURCE_URL,
      use: RESOURCE_URL,
    },
  },
  ping: {
    fallback: RESOURCE_URL_LIST,
    elements: { a: RESOURCE_URL_LIST, area: RESOURCE_URL_LIST },
  },
  poster: { fallback: IMAGE_URL, elements: { video: IMAGE_URL } },
  src: {
    fallback: RESOURCE_URL,
    elements: {
      audio: MEDIA_URL,
      img: IMAGE_URL,
      input: IMAGE_URL,
      source: MEDIA_URL,
      track: MEDIA_URL,
      video: MEDIA_URL,
    },
  },
  srcset: {
    fallback: IMAGE_SRCSET,
    elements: { img: IMAGE_SRCSET, source: IMAGE_SRCSET },
  },
};

export const isUrlBearingAttributeName = (key: string): boolean =>
  Object.hasOwn(URL_ATTRIBUTE_RULES, key.toLowerCase());

const urlAttributePolicy = (node: globalThis.Element, key: string): UrlAttributePolicy | null => {
  const rule = URL_ATTRIBUTE_RULES[key];
  if (rule === undefined) return null;

  return rule.elements[node.localName.toLowerCase()] ?? rule.fallback;
};

export const applyPropValue = (
  node: globalThis.Element,
  key: string,
  value: unknown,
  safeUrlConfig: SafeUrl.SafeUrlConfigService,
): Option.Option<BlockedSafeUrlAttribute> => {
  const normalizedKey = key.toLowerCase();
  if (normalizedKey.startsWith("on")) return Option.none();

  if (key === "style" && typeof value === "object" && value !== null) {
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      Object.assign(node.style, value);
    }
  } else if (key === "className") {
    node.setAttribute("class", String(value));
  } else if (key === "htmlFor") {
    node.setAttribute("for", String(value));
  } else if (key === "checked" && node instanceof HTMLInputElement) {
    node.checked = Boolean(value);
  } else if (
    key === "value" &&
    (node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement)
  ) {
    // Skip updating focused inputs to avoid resetting fast user typing.
    const isFocused = document.activeElement === node;
    if (!isFocused) {
      node.value = String(value);
    }
  } else if (key === "disabled") {
    if (value) {
      node.setAttribute("disabled", "");
    } else {
      node.removeAttribute("disabled");
    }
  } else if (key === "hidden") {
    if (value) {
      node.setAttribute("hidden", "");
    } else {
      node.removeAttribute("hidden");
    }
  } else if (key.startsWith("data-") || key.startsWith("aria-")) {
    if (value === undefined || value === null || value === false) {
      node.removeAttribute(key);
    } else {
      node.setAttribute(key, String(value));
    }
  } else {
    const policy = urlAttributePolicy(node, normalizedKey);
    if (policy !== null) {
      const url = String(value);
      const allowedSchemes = SafeUrl.allowedSchemesForSink(policy.sink, safeUrlConfig);

      if (policy.grammar === "single") {
        const validated = SafeUrl.validateSyncForSink(url, policy.sink, safeUrlConfig);
        if (Option.isSome(validated)) {
          node.setAttribute(normalizedKey, validated.value);
        } else {
          node.removeAttribute(normalizedKey);
          return Option.some({ key, url, allowedSchemes });
        }
      } else {
        const candidates = policy.grammar === "srcset" ? srcSetUrls(url) : spaceSeparatedUrls(url);
        if (
          candidates.length === 0 ||
          candidates.some((candidate) =>
            Option.isNone(SafeUrl.validateSyncForSink(candidate, policy.sink, safeUrlConfig)),
          )
        ) {
          node.removeAttribute(normalizedKey);
          return Option.some({ key, url, allowedSchemes });
        }
        node.setAttribute(normalizedKey, url);
      }
    } else if (key !== "children" && key !== "key" && typeof value !== "function") {
      if (typeof value === "boolean") {
        if (value) {
          node.setAttribute(key, "");
        } else {
          node.removeAttribute(key);
        }
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }

  return Option.none();
};

/**
 * Move all DOM nodes in the inclusive range before the reference node.
 * @internal
 */
export const moveRange = (startNode: Node, endNode: Node, beforeRef: Node): void => {
  const parentNode = beforeRef.parentNode;
  if (parentNode === null) {
    return;
  }

  let current: Node | null = startNode;
  while (current !== null) {
    const next: Node | null = current.nextSibling;
    if (current.parentNode === null || beforeRef.parentNode !== parentNode) {
      return;
    }
    parentNode.insertBefore(current, beforeRef);
    if (current === endNode) {
      return;
    }
    current = next;
  }
};
