import { Component } from "trygg";

export default Component.gen(function* () {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16"
    >
      <div className="flex flex-col items-center gap-8 text-center">
        <h1 className="font-mono text-sm font-medium tracking-wide text-[var(--muted)]">trygg</h1>

        <p className="text-pretty text-lg leading-relaxed text-[var(--ink)]">
          Get started by editing{" "}
          <code className="rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-sm">
            app/pages/home.tsx
          </code>
        </p>

        <div className="flex flex-wrap justify-center gap-3">
          <a
            className="touch-manipulation rounded-lg border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--ink-faint)] hover:bg-[var(--card-hover)] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            href="https://github.com/EduSantosBrito/trygg"
            target="_blank"
            rel="noreferrer"
          >
            Docs
          </a>
          <a
            className="touch-manipulation rounded-lg border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] no-underline transition-[background-color,border-color] duration-150 hover:border-[var(--ink-faint)] hover:bg-[var(--card-hover)] focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            href="https://github.com/EduSantosBrito/trygg"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>

        <pre className="w-full max-w-md overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--card)] p-4 text-left font-mono text-[13px] leading-relaxed text-[var(--muted)]">{`bun run dev          # http://localhost:5173
bun run build        # production bundle`}</pre>
      </div>
    </main>
  );
});
