/**
 * MINI-TRYGG — runtime JSX mínimo para isolar o problema de type inference.
 * Só existe para ser analisado pelo compilador; corpos de função são stubs.
 */

export class UserRepository {
  readonly _brand = "UserRepository";
}

export class HttpClient {
  readonly _brand = "HttpClient";
}

export class RepositoryInitError extends Error {
  readonly _tag = "RepositoryInitError";
}

// ---------------------------------------------------------------------------
// Modelo de Element com marca fantasma de requisitos
// ---------------------------------------------------------------------------
declare const __requirements: unique symbol;

export interface Element {
  readonly _tag: "Element";
}

/** Element carregando requisitos pendentes R */
export type WithRequirements<R> = Element & { readonly [__requirements]: R };

/** Extrai R de um elemento (nunca de Element puro) */
export type RequirementsOf<T> = T extends { readonly [__requirements]: infer R } ? R : never;

/** Elemento "quitado": nada pendente. É o que o mount aceita. */
export type SettledElement = Element & { readonly [__requirements]?: never };

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export interface ComponentType<P = never, E = never, R = never> {
  readonly _tag: "EffectComponent";
  (props: [P] extends [never] ? {} : P): WithRequirements<R>;
}

type ComponentResult = Element | WithRequirements<unknown>;

/** Equivalente ao ExtractResultContext do trygg real */
type ReqFromResult<TResult> =
  TResult extends { readonly [__requirements]: infer R } ? R : never;

/** Marca de requisito entregue via yield (no trygg real: canal R do Effect) */
declare const __yield: unique symbol;
export interface RequiresService<S> {
  readonly [__yield]: S;
}

export function gen<Y, TResult extends ComponentResult>(
  f: () => Generator<Y, TResult, never>,
): ComponentType<
  never,
  never,
  ReqFromResult<TResult> | (Y extends { readonly [__yield]: infer S } ? S : never)
> {
  return ((_props: never) => ({ _tag: "Element" })) as never;
}

// ---------------------------------------------------------------------------
// Mount EXIGENTE: recusa qualquer elemento com requisito pendente
// ---------------------------------------------------------------------------
export declare function mount(root: unknown, element: SettledElement): void;

// ---------------------------------------------------------------------------
// Runtime jsx/jsxs com overload preservador de R
// ---------------------------------------------------------------------------
export function jsx(type: string, props: Record<string, unknown> | null): Element;
export function jsx<P, E, R>(
  type: ComponentType<P, E, R>,
  props: P | null,
): WithRequirements<R>;
export function jsx(_type: unknown, _props: unknown): Element {
  return { _tag: "Element" };
}
export const jsxs: typeof jsx = jsx;

// ---------------------------------------------------------------------------
// Layer algebra
// ---------------------------------------------------------------------------
declare const __layerOutput: unique symbol;
declare const __layerError: unique symbol;
declare const __layerInput: unique symbol;

export interface Layer<ROut, E = never, RIn = never> {
  readonly [__layerOutput]: ROut;
  readonly [__layerError]: E;
  readonly [__layerInput]: RIn;
  readonly name: string;
  readonly outputs: ReadonlyArray<unknown>;
  readonly inputs: ReadonlyArray<unknown>;
  readonly errors: ReadonlyArray<unknown>;
}

export interface LayerMetadata {
  readonly name: string;
  readonly outputs: ReadonlyArray<unknown>;
  readonly inputs: ReadonlyArray<unknown>;
  readonly errors: ReadonlyArray<unknown>;
}

const metadataName = (value: unknown): string =>
  typeof value === "function" ? value.name : String(value);

const uniqueMetadata = (values: ReadonlyArray<unknown>): ReadonlyArray<unknown> => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const name = metadataName(value);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
};

export const Layer = {
  make<ROut, E = never, RIn = never>(metadata: LayerMetadata): Layer<ROut, E, RIn> {
    return metadata as Layer<ROut, E, RIn>;
  },

  provide<POut, PErr, PIn>(provider: Layer<POut, PErr, PIn>) {
    return <TOut, TErr, TIn>(
      target: Layer<TOut, TErr, TIn>,
    ): Layer<TOut, TErr | PErr, PIn | Exclude<TIn, POut>> => {
      const providerOutputs = new Set(provider.outputs.map(metadataName));
      return {
        name: `${provider.name} -> ${target.name}`,
        outputs: target.outputs,
        inputs: uniqueMetadata([
          ...provider.inputs,
          ...target.inputs.filter((input) => !providerOutputs.has(metadataName(input))),
        ]),
        errors: uniqueMetadata([...target.errors, ...provider.errors]),
      } as Layer<TOut, TErr | PErr, PIn | Exclude<TIn, POut>>;
    };
  },

  merge<AOut, AErr, AIn, BOut, BErr, BIn>(
    a: Layer<AOut, AErr, AIn>,
    b: Layer<BOut, BErr, BIn>,
  ): Layer<AOut | BOut, AErr | BErr, AIn | BIn> {
    return {
      name: `${a.name} + ${b.name}`,
      outputs: uniqueMetadata([...a.outputs, ...b.outputs]),
      inputs: uniqueMetadata([...a.inputs, ...b.inputs]),
      errors: uniqueMetadata([...a.errors, ...b.errors]),
    } as Layer<AOut | BOut, AErr | BErr, AIn | BIn>;
  },
};

export function provide<ROut, E2, RIn>(
  _layer: Layer<ROut, E2, RIn>,
): <P, E, R>(component: ComponentType<P, E, R>) => ComponentType<P, E | E2, RIn | Exclude<R, ROut>> {
  return ((c: ComponentType<never, never, never>) => c) as never;
}

// Namespace JSX consumido pelo compilador no modo react-jsx
export namespace JSX {
  export type Element = import("./jsx-runtime.js").Element;
  export interface IntrinsicAttributes {
    readonly key?: string;
  }
  export interface IntrinsicElements {
    div: Record<string, unknown>;
    span: Record<string, unknown>;
  }
  export interface ElementChildrenAttribute {
    children: {};
  }
}
