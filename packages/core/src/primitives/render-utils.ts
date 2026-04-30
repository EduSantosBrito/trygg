import { Option } from "effect";
import * as SafeUrl from "../security/safe-url.js";

/**
 * Apply a single prop value to a DOM element.
 * @internal
 */
export const applyPropValue = (node: HTMLElement, key: string, value: unknown): void => {
  if (key === "style" && typeof value === "object" && value !== null) {
    Object.assign(node.style, value);
  } else if (key === "className") {
    node.className = String(value);
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
    node.setAttribute(key, String(value));
  } else if (key === "href" || key === "src") {
    const url = String(value);
    const validated = SafeUrl.validateSync(url);
    if (Option.isSome(validated)) {
      node.setAttribute(key, validated.value);
    } else {
      const config = SafeUrl.getConfig();
      console.warn(
        `[trygg] Blocked unsafe ${key}="${url}". ` +
          `Allowed schemes: ${config.allowedSchemes.join(", ")}. ` +
          `See SafeUrl.allowSchemes() to add custom schemes.`,
      );
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
