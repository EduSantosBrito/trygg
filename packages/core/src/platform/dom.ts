/**
 * @since 1.0.0
 * Dom Service
 *
 * All document and element operations — creation, mutation, attributes, properties, queries.
 */
import { Effect, Layer, Schema } from "effect";
import * as Context from "effect/Context";

// =============================================================================
// Error type
// =============================================================================

export class DomError extends Schema.TaggedError<DomError>()("DomError", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

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
    root?: ParentNode,
  ) => Effect.Effect<Element | null, DomError>;
  readonly querySelectorAll: (
    selector: string,
    root?: ParentNode,
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

export interface Dom extends Context.Service<
  Dom,
  {
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
    readonly setAttribute: (
      el: Element,
      key: string,
      value: string,
    ) => Effect.Effect<void, DomError>;
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
      root?: ParentNode,
    ) => Effect.Effect<Element | null, DomError>;
    readonly querySelectorAll: (
      selector: string,
      root?: ParentNode,
    ) => Effect.Effect<NodeListOf<Element>, DomError>;
    readonly getElementById: (id: string) => Effect.Effect<Element | null, DomError>;
    readonly head: Effect.Effect<HTMLHeadElement, DomError>;
    readonly body: Effect.Effect<HTMLElement, DomError>;
    readonly documentElement: Effect.Effect<HTMLElement, DomError>;
    readonly activeElement: Effect.Effect<Element | null, DomError>;
    readonly matches: (el: Element, selector: string) => Effect.Effect<boolean, DomError>;
  }
> {}

export const Dom = Context.Service<
  Dom,
  {
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
    readonly setAttribute: (
      el: Element,
      key: string,
      value: string,
    ) => Effect.Effect<void, DomError>;
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
      root?: ParentNode,
    ) => Effect.Effect<Element | null, DomError>;
    readonly querySelectorAll: (
      selector: string,
      root?: ParentNode,
    ) => Effect.Effect<NodeListOf<Element>, DomError>;
    readonly getElementById: (id: string) => Effect.Effect<Element | null, DomError>;
    readonly head: Effect.Effect<HTMLHeadElement, DomError>;
    readonly body: Effect.Effect<HTMLElement, DomError>;
    readonly documentElement: Effect.Effect<HTMLElement, DomError>;
    readonly activeElement: Effect.Effect<Element | null, DomError>;
    readonly matches: (el: Element, selector: string) => Effect.Effect<boolean, DomError>;
  }
>("trygg/platform/Dom");

// =============================================================================
// Browser layer
// =============================================================================

const readDocumentHead = (): HTMLHeadElement | null => document.head;
const readDocumentBody = (): HTMLElement | null => document.body;
const readDocumentElement = (): HTMLElement | null => document.documentElement;

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
        try: () => Reflect.set(node, key, value),
        catch: (cause) => new DomError({ operation: "setProperty", cause }),
      }).pipe(
        Effect.flatMap((written) =>
          written
            ? Effect.void
            : Effect.fail(
                new DomError({
                  operation: "setProperty",
                  cause: `Reflect.set returned false for property "${key}"`,
                }),
              ),
        ),
      ),

    assignStyle: (el, styles) =>
      Effect.try({
        try: () => {
          Object.assign(el.style, styles);
        },
        catch: (cause) => new DomError({ operation: "assignStyle", cause }),
      }),

    querySelector: (selector, root) =>
      Effect.try({
        try: () => (root ?? document).querySelector(selector),
        catch: (cause) => new DomError({ operation: "querySelector", cause }),
      }),

    querySelectorAll: (selector, root) =>
      Effect.try({
        try: () => (root ?? document).querySelectorAll(selector),
        catch: (cause) => new DomError({ operation: "querySelectorAll", cause }),
      }),

    getElementById: (id) =>
      Effect.try({
        try: () => document.getElementById(id),
        catch: (cause) => new DomError({ operation: "getElementById", cause }),
      }),

    head: Effect.try({
      try: readDocumentHead,
      catch: (cause) => new DomError({ operation: "head", cause }),
    }).pipe(
      Effect.flatMap((head) =>
        head === null
          ? Effect.fail(new DomError({ operation: "head", cause: "document.head is not ready" }))
          : Effect.succeed(head),
      ),
    ),

    body: Effect.try({
      try: readDocumentBody,
      catch: (cause) => new DomError({ operation: "body", cause }),
    }).pipe(
      Effect.flatMap((body) =>
        body === null
          ? Effect.fail(new DomError({ operation: "body", cause: "document.body is not ready" }))
          : Effect.succeed(body),
      ),
    ),

    documentElement: Effect.try({
      try: readDocumentElement,
      catch: (cause) => new DomError({ operation: "documentElement", cause }),
    }).pipe(
      Effect.flatMap((documentElement) =>
        documentElement === null
          ? Effect.fail(
              new DomError({
                operation: "documentElement",
                cause: "document.documentElement is not ready",
              }),
            )
          : Effect.succeed(documentElement),
      ),
    ),

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

export const test: Layer.Layer<Dom> = browser;
