/**
 * Home Page — trygg.dev
 */
import { Effect } from "effect";
import { Component, Signal } from "trygg";
import { copy, sections } from "../content/copy";
import { CodeBlock, highlightCode } from "../components/code-block";

// =============================================================================
// Code Example
// =============================================================================

const codeExample = `import { Component, type ComponentProps } from "trygg";
import { Theme } from "./theme";

type ThemeTitleProps = { title: string };

/**
 * Type definition is:
 * Component.Type<
 *   ThemeTitleProps,  - component props
 *   never,  - error type
 *   Theme   - requirements
 * >
 */
export const ThemedTitle = Component.gen(
  function* (Props: ComponentProps<ThemeTitleProps>) {
    const { title } = yield* Props;
    const theme = yield* Theme;

    return <h3
      style={{ color: theme.primary }}
    >
      {title}
    </h3>;
  }
);`;

const highlightedCode = await highlightCode(codeExample, "tsx");

// =============================================================================
// Hero
// =============================================================================

const Hero = Component.gen(function* () {
  return (
    <section
      aria-labelledby="hero-title"
      className="min-h-screen grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center px-6 py-16 lg:py-24 max-w-6xl mx-auto"
    >
      <div className="flex flex-col items-center lg:items-start text-center lg:text-left">
        <span
          role="status"
          className="inline-flex px-3 py-1.5 rounded-full text-xs font-medium mb-4 lg:mb-6 bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[rgba(250,204,21,0.15)]"
        >
          {copy.canaryWarning}
        </span>

        <h1
          id="hero-title"
          className="text-3xl lg:text-5xl font-semibold tracking-tight leading-tight mb-4 lg:mb-6 text-[var(--color-text)]"
        >
          {copy.heroTitle}
        </h1>

        <p className="text-base lg:text-lg text-[var(--color-text-muted)] leading-relaxed mb-6 lg:mb-8 max-w-md">
          {copy.heroSubtitle}
        </p>

        <div className="flex gap-3">
          <a
            href={copy.primaryCtaHref}
            className="inline-flex items-center gap-2 px-5 lg:px-7 py-3 lg:py-3.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] text-white text-sm lg:text-base font-semibold rounded-lg transition-colors"
            data-fast-goal="hero_try_click"
          >
            {copy.primaryCtaLabel}
            <span aria-hidden="true">&darr;</span>
          </a>
        </div>
      </div>

      <div className="relative w-full lg:w-[140%] lg:-mr-[40%]">
        <CodeBlock lines={highlightedCode} header="bunx create-trygg@canary" fileType="TSX" />
      </div>
    </section>
  );
});

// =============================================================================
// Built on Effect
// =============================================================================

const BuiltOnEffect = Component.gen(function* () {
  return (
    <div className="py-6 border-y border-[var(--color-border)] bg-gradient-to-r from-transparent via-[rgba(139,92,246,0.03)] to-transparent">
      <div className="max-w-6xl mx-auto px-6">
        <p className="text-center text-[var(--color-text-muted)] text-sm">
          {sections.builtOnEffect.statement}{" "}
          <a
            href={sections.builtOnEffect.linkHref}
            className="text-[var(--color-accent)] font-medium hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {sections.builtOnEffect.linkText} &rarr;
          </a>
        </p>
      </div>
    </div>
  );
});

// =============================================================================
// Features
// =============================================================================

const Features = Component.gen(function* () {
  return (
    <section aria-labelledby="features-title" className="py-16 lg:py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <h2
          id="features-title"
          className="text-xs font-medium uppercase tracking-widest text-[var(--color-text-muted)] mb-12"
        >
          {sections.features.heading}
        </h2>

        <ul
          role="list"
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-xl overflow-hidden"
        >
          {sections.features.cards.map((card, i) => (
            <li
              key={i}
              className="bg-[var(--color-bg)] p-8 hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              <h3 className="font-mono text-sm font-medium text-[var(--color-accent)] mb-3">
                {card.title}
              </h3>
              <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
                {card.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
});

// =============================================================================
// Install
// =============================================================================

const Install = Component.gen(function* () {
  const copied = yield* Signal.make(false);
  const buttonLabel = yield* Signal.derive(copied, (c) => (c ? "Copied!" : "Copy"));

  const handleCopy = () =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(() => navigator.clipboard.writeText(sections.install.command));
      yield* Effect.sync(() => window.datafast?.("install_copy_click"));
      yield* Signal.set(copied, true);
      yield* Effect.sleep("2 seconds");
      yield* Signal.set(copied, false);
    }).pipe(Effect.ignore);

  return (
    <section id="install" aria-labelledby="install-title" className="py-16 lg:py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <h2
          id="install-title"
          className="text-xs font-medium uppercase tracking-widest text-[var(--color-text-muted)] mb-12"
        >
          {sections.install.heading}
        </h2>

        <div className="max-w-lg mx-auto">
          <div
            className="flex items-center gap-3 px-5 py-4 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] rounded-xl font-mono text-sm"
            role="group"
            aria-label="Installation command"
          >
            <span className="text-[var(--color-accent)] select-none" aria-hidden="true">
              $
            </span>
            <code className="flex-1 text-[var(--color-text)]">{sections.install.command}</code>
            <button
              type="button"
              className="px-3 py-1.5 text-xs bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] rounded transition-colors cursor-pointer"
              onClick={handleCopy}
              aria-label="Copy installation command to clipboard"
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

// =============================================================================
// FAQ
// =============================================================================

const FAQ = Component.gen(function* () {
  return (
    <section
      aria-labelledby="faq-title"
      className="py-16 lg:py-24 px-6 bg-[var(--color-bg-subtle)]"
    >
      <div className="max-w-2xl mx-auto">
        <h2
          id="faq-title"
          className="text-xs font-medium uppercase tracking-widest text-[var(--color-text-muted)] mb-12"
        >
          {sections.faq.heading}
        </h2>

        <dl className="divide-y divide-[var(--color-border)]">
          {sections.faq.questions.map((item, i) => (
            <div key={i} className="py-6 first:pt-0 last:pb-0">
              <dt className="font-semibold text-[var(--color-text)] mb-2">{item.q}</dt>
              <dd className="text-sm text-[var(--color-text-muted)] leading-relaxed">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
});

// =============================================================================
// Footer
// =============================================================================

const Footer = Component.gen(function* () {
  return (
    <footer
      role="contentinfo"
      className="py-16 px-6 border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)]"
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between gap-8 mb-12">
          <div className="max-w-xs">
            <span className="text-xl font-semibold text-[var(--color-text)]">trygg</span>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Effect-native UI framework
            </p>
          </div>

          <div className="flex gap-16">
            <nav aria-label="Resources">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-subtle)] mb-4">
                Resources
              </h4>
              <ul role="list" className="flex flex-col gap-3">
                {/* TODO: uncomment when docs are live
                <li>
                  <a href="https://docs.trygg.dev" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors">
                    Documentation
                  </a>
                </li>
                */}
                <li>
                  <a
                    href={sections.community.github.href}
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.npmjs.com/package/trygg"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    npm
                  </a>
                </li>
                <li>
                  <a
                    href="https://npmx.dev/package/trygg"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    npmx
                  </a>
                </li>
              </ul>
            </nav>

            <nav aria-label="Community">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-subtle)] mb-4">
                Community
              </h4>
              <ul role="list" className="flex flex-col gap-3">
                <li>
                  <a
                    href="https://effect.website"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Effect
                  </a>
                </li>
                <li>
                  <a
                    href="https://discord.gg/effect-ts"
                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Effect Discord
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="pt-8 border-t border-[var(--color-border)] flex items-center justify-between gap-4">
          <small className="text-xs text-[var(--color-text-subtle)]">MIT License</small>
          <small className="text-xs text-[var(--color-text-subtle)]">Made with trygg</small>
        </div>
      </div>
    </footer>
  );
});

// =============================================================================
// Home Page
// =============================================================================

export default Component.gen(function* () {
  return (
    <div className="bg-grid overflow-x-clip">
      {/* Skip link for keyboard navigation */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--color-accent)] focus:text-white focus:rounded-lg focus:outline-none"
      >
        Skip to main content
      </a>

      <main id="main-content">
        <Hero />
        <BuiltOnEffect />
        <Features />
        <Install />
        <FAQ />
      </main>

      <Footer />
    </div>
  );
});
