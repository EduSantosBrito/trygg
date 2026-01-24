/**
 * @since 1.0.0
 * Dom Service
 *
 * All document and element operations — creation, mutation, attributes, properties, queries.
 */
import { Context, Data, Effect, Layer } from "effect";

// =============================================================================
// Error type
// =============================================================================

export class DomError extends Data.TaggedError("DomError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// =============================================================================
// Service interface
// =============================================================================

export interface DomService {
  readonly createElement: (tag: string) => Effect.Effect<HTMLElement, DomError>;
  readonly createComment: (text: string) => Effect.Effect<Comment, DomError>;
  readonly createTextNode: (text: string) => Effect.Effect<Text, DomError>;
  readonly createFragment: () => Effect.Effect<DocumentFragment, DomError>;
  readonly createTreeWalker: (
    root: Node,
    whatToShow: number,
  ) => Effect.Effect<TreeWalker, DomError>;
  readonly appendChild: (parent: Node, child: Node) => Effect.Effect<void, DomError>;
  readonly insertBefore: (
    parent: Node,
    node: Node,
    ref: Node | null,
  ) => Effect.Effect<void, DomError>;
  readonly replaceChild: (
    parent: Node,
    newChild: Node,
    oldChild: Node,
  ) => Effect.Effect<void, DomError>;
  readonly remove: (node: Node) => Effect.Effect<void, DomError>;
  readonly setAttribute: (el: Element, key: string, value: string) => Effect.Effect<void, DomError>;
  readonly removeAttribute: (el: Element, key: string) => Effect.Effect<void, DomError>;
  readonly getAttribute: (el: Element, key: string) => Effect.Effect<string | null, DomError>;
  readonly setProperty: (
    node: object,
    key: string,
    value: unknown,
  ) => Effect.Effect<void, DomError>;
  readonly assignStyle: (el: HTMLElement, styles: object) => Effect.Effect<void, DomError>;
  readonly querySelector: (
    selector: string,
    root?: Node,
  ) => Effect.Effect<Element | null, DomError>;
  readonly querySelectorAll: (
    selector: string,
    root?: Node,
  ) => Effect.Effect<NodeListOf<Element>, DomError>;
  readonly getElementById: (id: string) => Effect.Effect<Element | null, DomError>;
  readonly head: Effect.Effect<HTMLHeadElement, DomError>;
  readonly body: Effect.Effect<HTMLElement, DomError>;
  readonly documentElement: Effect.Effect<HTMLElement, DomError>;
  readonly activeElement: Effect.Effect<Element | null, DomError>;
  readonly matches: (el: Element, selector: string) => Effect.Effect<boolean, DomError>;
}

// =============================================================================
// Tag
// =============================================================================

export class Dom extends Context.Tag("trygg/platform/Dom")<Dom, DomService>() {}

// =============================================================================
// Browser layer
// =============================================================================

export const browser: Layer.Layer<Dom> = Layer.succeed(
  Dom,
  Dom.of({
    createElement: (tag) =>
      Effect.try({
        try: () => document.createElement(tag),
        catch: (cause) => new DomError({ operation: "createElement", cause }),
      }),

    createComment: (text) =>
      Effect.try({
        try: () => document.createComment(text),
        catch: (cause) => new DomError({ operation: "createComment", cause }),
      }),

    createTextNode: (text) =>
      Effect.try({
        try: () => document.createTextNode(text),
        catch: (cause) => new DomError({ operation: "createTextNode", cause }),
      }),

    createFragment: () =>
      Effect.try({
        try: () => document.createDocumentFragment(),
        catch: (cause) => new DomError({ operation: "createFragment", cause }),
      }),

    createTreeWalker: (root, whatToShow) =>
      Effect.try({
        try: () => document.createTreeWalker(root, whatToShow),
        catch: (cause) => new DomError({ operation: "createTreeWalker", cause }),
      }),

    appendChild: (parent, child) =>
      Effect.try({
        try: () => {
          parent.appendChild(child);
        },
        catch: (cause) => new DomError({ operation: "appendChild", cause }),
      }),

    insertBefore: (parent, node, ref) =>
      Effect.try({
        try: () => {
          parent.insertBefore(node, ref);
        },
        catch: (cause) => new DomError({ operation: "insertBefore", cause }),
      }),

    replaceChild: (parent, newChild, oldChild) =>
      Effect.try({
        try: () => {
          parent.replaceChild(newChild, oldChild);
        },
        catch: (cause) => new DomError({ operation: "replaceChild", cause }),
      }),

    remove: (node) =>
      Effect.try({
        try: () => {
          if (node.parentNode !== null) {
            node.parentNode.removeChild(node);
          }
        },
        catch: (cause) => new DomError({ operation: "remove", cause }),
      }),

    setAttribute: (el, key, value) =>
      Effect.try({
        try: () => {
          el.setAttribute(key, value);
        },
        catch: (cause) => new DomError({ operation: "setAttribute", cause }),
      }),

    removeAttribute: (el, key) =>
      Effect.try({
        try: () => {
          el.removeAttribute(key);
        },
        catch: (cause) => new DomError({ operation: "removeAttribute", cause }),
      }),

    getAttribute: (el, key) =>
      Effect.try({
        try: () => el.getAttribute(key),
        catch: (cause) => new DomError({ operation: "getAttribute", cause }),
      }),

    setProperty: (node, key, value) =>
      Effect.try({
        try: () => {
          Reflect.set(node, key, value);
        },
        catch: (cause) => new DomError({ operation: "setProperty", cause }),
      }),

    assignStyle: (el, styles) =>
      Effect.try({
        try: () => {
          Object.assign(el.style, styles);
        },
        catch: (cause) => new DomError({ operation: "assignStyle", cause }),
      }),

    querySelector: (selector, root) =>
      Effect.try({
        try: () => {
          if (root === undefined) return document.querySelector(selector);
          if (root instanceof Element) return root.querySelector(selector);
          if (root instanceof Document) return root.querySelector(selector);
          if (root instanceof DocumentFragment) return root.querySelector(selector);
          return null;
        },
        catch: (cause) => new DomError({ operation: "querySelector", cause }),
      }),

    querySelectorAll: (selector, root) =>
      Effect.try({
        try: () => {
          if (root === undefined) return document.querySelectorAll(selector);
          if (root instanceof Element) return root.querySelectorAll(selector);
          if (root instanceof Document) return root.querySelectorAll(selector);
          if (root instanceof DocumentFragment) return root.querySelectorAll(selector);
          return document.querySelectorAll(selector);
        },
        catch: (cause) => new DomError({ operation: "querySelectorAll", cause }),
      }),

    getElementById: (id) =>
      Effect.try({
        try: () => document.getElementById(id),
        catch: (cause) => new DomError({ operation: "getElementById", cause }),
      }),

    head: Effect.try({
      try: () => document.head,
      catch: (cause) => new DomError({ operation: "head", cause }),
    }),

    body: Effect.try({
      try: () => document.body,
      catch: (cause) => new DomError({ operation: "body", cause }),
    }),

    documentElement: Effect.try({
      try: () => document.documentElement,
      catch: (cause) => new DomError({ operation: "documentElement", cause }),
    }),

    activeElement: Effect.try({
      try: () => document.activeElement,
      catch: (cause) => new DomError({ operation: "activeElement", cause }),
    }),

    matches: (el, selector) =>
      Effect.try({
        try: () => el.matches(selector),
        catch: (cause) => new DomError({ operation: "matches", cause }),
      }),
  }),
);

// =============================================================================
// Test layer
// =============================================================================

export const test: Layer.Layer<Dom> = Layer.succeed(
  Dom,
  Dom.of({
    createElement: (tag) =>
      Effect.sync(
        () =>
          ({
            tagName: tag.toUpperCase(),
            childNodes: [],
            attributes: new Map(),
            style: {},
          }) as unknown as HTMLElement,
      ),
    createComment: (text) => Effect.sync(() => ({ nodeType: 8, data: text }) as unknown as Comment),
    createTextNode: (text) =>
      Effect.sync(() => ({ nodeType: 3, data: text, textContent: text }) as unknown as Text),
    createFragment: () =>
      Effect.sync(() => ({ nodeType: 11, childNodes: [] }) as unknown as DocumentFragment),
    createTreeWalker: (_root, _whatToShow) =>
      Effect.sync(() => ({ nextNode: () => null }) as unknown as TreeWalker),
    appendChild: (_parent, _child) => Effect.void,
    insertBefore: (_parent, _node, _ref) => Effect.void,
    replaceChild: (_parent, _newChild, _oldChild) => Effect.void,
    remove: (_node) => Effect.void,
    setAttribute: (_el, _key, _value) => Effect.void,
    removeAttribute: (_el, _key) => Effect.void,
    getAttribute: (_el, _key) => Effect.succeed(null),
    setProperty: (_node, _key, _value) => Effect.void,
    assignStyle: (_el, _styles) => Effect.void,
    querySelector: (_selector, _root) => Effect.succeed(null),
    querySelectorAll: (_selector, _root) => Effect.sync(() => [] as unknown as NodeListOf<Element>),
    getElementById: (_id) => Effect.succeed(null),
    head: Effect.sync(() => ({ tagName: "HEAD", childNodes: [] }) as unknown as HTMLHeadElement),
    body: Effect.sync(() => ({ tagName: "BODY", childNodes: [] }) as unknown as HTMLElement),
    documentElement: Effect.sync(
      () => ({ tagName: "HTML", childNodes: [] }) as unknown as HTMLElement,
    ),
    activeElement: Effect.succeed(null),
    matches: (_el, _selector) => Effect.succeed(false),
  }),
);
