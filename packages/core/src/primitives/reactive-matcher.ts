import { Effect, Pipeable } from "effect";
import { unsafeTagsExhaustive } from "../internal/unsafe.js";

export type Tagged = { readonly _tag: string };

export interface ReactiveMatcher<
  Kind extends string,
  Source,
  Handlers extends ReadonlyMap<string, unknown>,
>
  extends Pipeable.Pipeable {
  readonly _tag: Kind;
  readonly source: Source;
  readonly handlers: Handlers;
}

export const make = <Kind extends string, Source, Handlers extends ReadonlyMap<string, unknown>>(
  tag: Kind,
  source: Source,
  handlers: Handlers,
): ReactiveMatcher<Kind, Source, Handlers> => ({
  _tag: tag,
  source,
  handlers,
  pipe() {
    return Pipeable.pipeArguments(this, arguments);
  },
});

export const addHandler = <Handler>(
  handlers: ReadonlyMap<string, Handler>,
  tag: string,
  handler: Handler,
): ReadonlyMap<string, Handler> => {
  const next = new Map(handlers);
  next.set(tag, handler);
  return next;
};

export const tagsExhaustive = <State extends Tagged, Result>(handlers: {
  readonly [Tag in State["_tag"] & string]: (
    state: Extract<State, { readonly _tag: Tag }>,
  ) => Result;
}): ((state: State) => Result) => unsafeTagsExhaustive(handlers);

export const toReactiveElement = <Source, State, Derived, View, E, R>(
  source: Source,
  derive: (source: Source, render: (state: State) => View) => Effect.Effect<Derived, E, R>,
  makeElement: (signal: Derived) => View,
  render: (state: State) => View,
): Effect.Effect<View, E, R> => derive(source, render).pipe(Effect.map(makeElement));
