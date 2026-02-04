/**
 * Nested Provide Demo
 *
 * Demonstrates nested Component.provide() where child components access
 * services from multiple ancestor layers. The key scenario: an event handler
 * that accesses an ancestor service at click time (not captured in a closure).
 *
 * Layout provides ApiClientLive (grandparent)
 *   -> App provides Locale (parent)
 *     -> Card provides CardStyle (child)
 *       -> button onClick accesses Locale (ancestor) at click time
 */
import { Context, Effect, Layer } from "effect";
import { Signal, Component, type ComponentProps } from "trygg";

// =============================================================================
// Services — three layers of context
// =============================================================================

class Locale extends Context.Tag("demo/Locale")<
  Locale,
  { readonly lang: string; readonly greeting: string }
>() {}

class CardStyle extends Context.Tag("demo/CardStyle")<
  CardStyle,
  { readonly bg: string; readonly border: string; readonly accent: string }
>() {}

// =============================================================================
// Leaf component — reads both services, handler accesses Locale at click time
// =============================================================================

const GreetingCard = Component.gen(function* (
  Props: ComponentProps<{ readonly name: Signal.Signal<string> }>,
) {
  const { name } = yield* Props;
  const style = yield* CardStyle;
  const locale = yield* Locale;
  const nameValue = yield* Signal.get(name);

  return (
    <div
      className="p-5 rounded-lg border-2 border-solid mb-4"
      style={{ background: style.bg, borderColor: style.border }}
    >
      <h3 className="mt-0 text-lg" style={{ color: style.accent }}>
        {locale.greeting}, {nameValue}!
      </h3>
      <p className="text-sm text-gray-600 m-0 mb-3">
        Language: <strong>{locale.lang}</strong> | Accent:{" "}
        <strong style={{ color: style.accent }}>{style.accent}</strong>
      </p>
      <button
        className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm cursor-pointer hover:bg-gray-50"
        onClick={() =>
          // This handler accesses Locale at click time via Effect.gen.
          // Before the fix, Runtime.runFork would only get CardStyle context
          // (inner Provide replaced Locale context instead of merging).
          Effect.gen(function* () {
            const loc = yield* Locale;
            // eslint-disable-next-line no-alert
            globalThis.alert(`[${loc.lang}] ${loc.greeting} from the event handler!`);
          })
        }
      >
        Greet from handler
      </button>
    </div>
  );
});

// =============================================================================
// Mid-level — provides CardStyle, wraps GreetingCard
// =============================================================================

const StyledSection = Component.gen(function* (
  Props: ComponentProps<{
    readonly label: string;
    readonly name: Signal.Signal<string>;
    readonly style: Layer.Layer<CardStyle>;
  }>,
) {
  const { label, name, style } = yield* Props;
  const Provided = GreetingCard.provide(style);

  return (
    <div>
      <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">{label}</h4>
      <Provided name={name} />
    </div>
  );
});

// =============================================================================
// Page — provides Locale, nests StyledSections with different CardStyles
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

const EnglishLocale = Layer.succeed(Locale, { lang: "en", greeting: "Hello" });
const SpanishLocale = Layer.succeed(Locale, { lang: "es", greeting: "Hola" });
const PortugueseLocale = Layer.succeed(Locale, { lang: "pt-BR", greeting: "Oi" });

const locales = [
  { label: "English", layer: EnglishLocale },
  { label: "Español", layer: SpanishLocale },
  { label: "Português", layer: PortugueseLocale },
];

const NestedProvidePage = Component.gen(function* () {
  const name = yield* Signal.make("World");
  const localeIndex = yield* Signal.make(0);
  const idx = yield* Signal.get(localeIndex);
  const locale = locales[idx] ?? locales[0];

  const LocaleSection = StyledSection.provide(locale.layer);

  return (
    <div>
      <h2 className="m-0 mb-1 text-xl font-semibold">Nested Provide</h2>
      <p className="text-gray-500 m-0 mb-6 text-sm">
        Three layers of Context.Tag with dynamic layer switching. Locale swaps at runtime via signal
        — each click rebuilds the component tree with a new layer. The "Greet from handler" button
        accesses Locale at click time via Effect.gen, proving the ancestor context propagates
        through nested Provide elements into event handlers.
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
        <button
          className={`px-3 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
            idx === 0
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
          onClick={() => Signal.set(localeIndex, 0)}
        >
          English
        </button>
        <button
          className={`px-3 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
            idx === 1
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
          onClick={() => Signal.set(localeIndex, 1)}
        >
          Español
        </button>
        <button
          className={`px-3 py-1.5 rounded border text-sm cursor-pointer transition-colors ${
            idx === 2
              ? "bg-gray-800 text-white border-gray-800"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
          onClick={() => Signal.set(localeIndex, 2)}
        >
          Português
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LocaleSection label="Ocean" name={name} style={OceanStyle} />
        <LocaleSection label="Sunset" name={name} style={SunsetStyle} />
        <LocaleSection label="Forest" name={name} style={ForestStyle} />
      </div>

      <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500 font-mono leading-relaxed">
        <p className="m-0 mb-1">
          <strong>Context stack:</strong>
        </p>
        <p className="m-0">Layout → ApiClientLive (grandparent)</p>
        <p className="m-0 ml-4">→ Locale [{locale.label}] (parent — switchable)</p>
        <p className="m-0 ml-8">→ CardStyle [Ocean|Sunset|Forest] (child — per section)</p>
        <p className="m-0 ml-12">
          → GreetingCard reads both + handler accesses Locale at click time
        </p>
      </div>
    </div>
  );
});

export default NestedProvidePage;
