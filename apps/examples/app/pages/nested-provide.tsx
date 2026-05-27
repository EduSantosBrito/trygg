/**
 * Nested Provide Demo
 *
 * Demonstrates stable Component.provide(layer) boundaries where child
 * components access services from multiple ancestor layers. Interactive locale
 * state lives inside a lifecycle-provided store instead of swapping provider
 * layers during render.
 *
 * Layout provides ApiClientLive (grandparent)
 *   -> Page provides LocaleStoreLive (parent)
 *     -> Card sections provide CardStyle (child)
 *       -> button onClick accesses LocaleStore at click time
 */
import { Effect, Layer } from "effect";
import * as Context from "effect/Context";
import { Signal, Component, type ComponentProps } from "trygg";

// =============================================================================
// Services — stable provider boundaries plus scoped reactive store state
// =============================================================================

type LocaleCode = "en" | "es" | "pt-BR";

interface LocaleOption {
  readonly code: LocaleCode;
  readonly label: string;
  readonly greeting: string;
}

const localeOptions: ReadonlyArray<LocaleOption> = [
  { code: "en", label: "English", greeting: "Hello" },
  { code: "es", label: "Español", greeting: "Hola" },
  { code: "pt-BR", label: "Português", greeting: "Oi" },
];

const defaultLocale = localeOptions[0] ?? { code: "en", label: "English", greeting: "Hello" };

const localeForCode = (code: LocaleCode): LocaleOption =>
  localeOptions.find((locale) => locale.code === code) ?? defaultLocale;

class LocaleStore extends Context.Service<
  LocaleStore,
  {
    readonly selected: Signal.Signal<LocaleCode>;
    readonly label: Signal.Signal<string>;
    readonly greeting: Signal.Signal<string>;
    readonly setLocale: (code: LocaleCode) => Effect.Effect<void>;
  }
>()("demo/LocaleStore") {}

const LocaleStoreLive = Layer.effect(
  LocaleStore,
  Effect.gen(function* () {
    const selected = yield* Signal.make<LocaleCode>(defaultLocale.code);
    const label = yield* Signal.make(defaultLocale.label);
    const greeting = yield* Signal.make(defaultLocale.greeting);

    return {
      selected,
      label,
      greeting,
      setLocale: (code) =>
        Effect.gen(function* () {
          const next = localeForCode(code);
          yield* Signal.set(selected, next.code);
          yield* Signal.set(label, next.label);
          yield* Signal.set(greeting, next.greeting);
        }),
    };
  }).pipe(Effect.annotateLogs({ service: "LocaleStore" })),
);

class CardStyle extends Context.Service<
  CardStyle,
  { readonly bg: string; readonly border: string; readonly accent: string }
>()("demo/CardStyle") {}

// =============================================================================
// Leaf component — reads both services, handler accesses LocaleStore at click time
// =============================================================================

const GreetingCard = Component.gen(function* (
  Props: ComponentProps<{ readonly name: Signal.Signal<string> }>,
) {
  const { name } = yield* Props;
  const style = yield* CardStyle;
  const locale = yield* LocaleStore;
  const nameValue = yield* Signal.get(name);
  const greeting = yield* Signal.get(locale.greeting);
  const selected = yield* Signal.get(locale.selected);

  return (
    <div
      className="p-5 rounded-lg border-2 border-solid mb-4"
      style={{ background: style.bg, borderColor: style.border }}
    >
      <h3 className="mt-0 text-lg" style={{ color: style.accent }}>
        {greeting}, {nameValue}!
      </h3>
      <p className="text-sm text-gray-600 m-0 mb-3">
        Language: <strong>{selected}</strong> | Accent: {""}
        <strong style={{ color: style.accent }}>{style.accent}</strong>
      </p>
      <button
        className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm cursor-pointer hover:bg-gray-50"
        onClick={() =>
          // This handler accesses LocaleStore at click time via Effect.gen,
          // proving ancestor context propagates through nested provider
          // boundaries into event handlers.
          Effect.gen(function* () {
            const currentGreeting = yield* Signal.peek(locale.greeting);
            const currentLang = yield* Signal.peek(locale.selected);
            globalThis.alert(`[${currentLang}] ${currentGreeting} from the event handler!`);
          })
        }
      >
        Greet from handler
      </button>
    </div>
  );
});

// =============================================================================
// Mid-level — stable CardStyle provider boundaries
// =============================================================================

const OceanStyle = Layer.succeed(CardStyle, {
  bg: "#f0f9ff",
  border: "#7dd3fc",
  accent: "#0369a1",
});

const SunsetStyle = Layer.succeed(CardStyle, {
  bg: "#fff7ed",
  border: "#fdba74",
  accent: "#c2410c",
});

const ForestStyle = Layer.succeed(CardStyle, {
  bg: "#f0fdf4",
  border: "#86efac",
  accent: "#15803d",
});

const OceanGreetingCard = GreetingCard.pipe(Component.provide(OceanStyle));
const SunsetGreetingCard = GreetingCard.pipe(Component.provide(SunsetStyle));
const ForestGreetingCard = GreetingCard.pipe(Component.provide(ForestStyle));

const OceanSection = Component.gen(function* (
  Props: ComponentProps<{ readonly name: Signal.Signal<string> }>,
) {
  const { name } = yield* Props;

  return (
    <div>
      <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Ocean</h4>
      <OceanGreetingCard name={name} />
    </div>
  );
});

const SunsetSection = Component.gen(function* (
  Props: ComponentProps<{ readonly name: Signal.Signal<string> }>,
) {
  const { name } = yield* Props;

  return (
    <div>
      <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Sunset</h4>
      <SunsetGreetingCard name={name} />
    </div>
  );
});

const ForestSection = Component.gen(function* (
  Props: ComponentProps<{ readonly name: Signal.Signal<string> }>,
) {
  const { name } = yield* Props;

  return (
    <div>
      <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Forest</h4>
      <ForestGreetingCard name={name} />
    </div>
  );
});

// =============================================================================
// Page — provides LocaleStore, nests sections with different CardStyles
// =============================================================================

const NestedProvidePage = Component.gen(function* () {
  const name = yield* Signal.make("World");
  const locale = yield* LocaleStore;
  const selected = yield* Signal.get(locale.selected);
  const selectedLabel = yield* Signal.get(locale.label);

  return (
    <div>
      <h2 className="m-0 mb-1 text-xl font-semibold">Nested Provide</h2>
      <p className="text-gray-500 m-0 mb-6 text-sm">
        Stable provider boundaries supply services; locale changes are scoped signal state inside
        LocaleStoreLive. Updating the locale rerenders the cards without rebuilding provider layers
        during render.
      </p>

      <div className="flex gap-3 mb-6">
        <input
          className="px-3 py-1.5 border border-gray-300 rounded text-sm"
          type="text"
          placeholder="Name"
          value={yield* Signal.get(name)}
          onInput={(e: Event) => {
            const target = e.target;
            if (target instanceof HTMLInputElement) {
              return Signal.set(name, target.value);
            }
            return Effect.void;
          }}
        />
        {localeOptions.map((option) => (
          <button
            key={option.code}
            className={`px-3 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
              selected === option.code
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
            onClick={() => locale.setLocale(option.code)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <OceanSection name={name} />
        <SunsetSection name={name} />
        <ForestSection name={name} />
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500 font-mono leading-relaxed">
        <p className="m-0 mb-1">
          <strong>Context stack:</strong>
        </p>
        <p className="m-0">Layout → ApiClientLive (grandparent)</p>
        <p className="m-0 ml-4">→ LocaleStoreLive [{selectedLabel}] (parent)</p>
        <p className="m-0 ml-8">→ CardStyle [Ocean|Sunset|Forest] (child)</p>
        <p className="m-0 ml-12">
          → GreetingCard reads both + handler accesses LocaleStore at click time
        </p>
      </div>
    </div>
  );
});

export default NestedProvidePage.pipe(Component.provide(LocaleStoreLive));
