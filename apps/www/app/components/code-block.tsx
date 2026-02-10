/**
 * Syntax-highlighted code block using Shiki
 *
 * Pre-renders code at module load time for static examples
 */
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { Component, type ComponentProps } from "trygg";
import type { Element as HastElement, Text as HastText, RootContent, Root as HastRoot } from "hast";

type HastNode = HastElement | HastText;

// Type guards for HAST nodes
const isHastElement = (node: RootContent): node is HastElement =>
  node.type === "element";

const isHastNode = (node: RootContent): node is HastNode =>
  node.type === "element" || node.type === "text";

// Pre-initialize highlighter with only what we need
let highlighter: HighlighterCore | null = null;

const getHighlighter = async () => {
  if (!highlighter) {
    highlighter = await createHighlighterCore({
      themes: [import("shiki/themes/github-dark.mjs")],
      langs: [import("shiki/langs/tsx.mjs")],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  }
  return highlighter;
};

function hastChildToJsx(node: HastNode, key: number) {
  if (node.type === "text") {
    return <span key={key}>{node.value}</span>;
  }

  const { properties, children } = node;
  const style = typeof properties?.style === "string" ? properties.style : undefined;

  const childElements = children.filter(isHastNode).map((child, i) => hastChildToJsx(child, i));

  if (style) {
    return (
      <span key={key} style={parseStyle(style)}>
        {childElements}
      </span>
    );
  }

  return <span key={key}>{childElements}</span>;
}

function parseStyle(styleStr: string): Record<string, string> {
  const style: Record<string, string> = {};
  styleStr.split(";").forEach((rule) => {
    const [prop, value] = rule.split(":").map((s) => s.trim());
    if (prop && value) {
      const camelProp = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      style[camelProp] = value;
    }
  });
  return style;
}

interface HighlightedLine {
  lineNumber: number;
  nodes: HastNode[];
}

export async function highlightCode(code: string, lang = "tsx"): Promise<HighlightedLine[]> {
  const hl = await getHighlighter();
  const hast: HastRoot = hl.codeToHast(code, {
    lang,
    theme: "github-dark",
  });

  // Shiki always produces: root > pre > code > (text|span)*
  const preNode = hast.children.find(isHastElement);
  if (!preNode) return [];

  const codeNode = preNode.children.find(isHastElement);
  if (!codeNode) return [];

  // Split by newlines to get lines
  const lines: HighlightedLine[] = [];
  let currentLine: HastNode[] = [];
  let lineNumber = 1;

  for (const child of codeNode.children.filter(isHastNode)) {
    if (child.type === "text") {
      const parts = child.value.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) {
          lines.push({ lineNumber: lineNumber++, nodes: currentLine });
          currentLine = [];
        }
        if (part) {
          currentLine.push({ type: "text", value: part });
        }
      });
    } else {
      currentLine.push(child);
    }
  }

  if (currentLine.length > 0) {
    lines.push({ lineNumber, nodes: currentLine });
  }

  return lines;
}

export const CodeBlock = Component.gen(function* (
  Props: ComponentProps<{
    lines: HighlightedLine[];
    header?: string;
    fileType?: string;
  }>,
) {
  const { lines, header, fileType } = yield* Props;

  return (
    <figure
      className="bg-[#0d0d0d] border border-[var(--color-border)] rounded-lg lg:rounded-xl overflow-hidden"
      role="figure"
      aria-label={header ? `Code example: ${header}` : "Code example"}
    >
      {header && (
        <div className="flex items-center justify-between px-3 lg:px-5 py-3 lg:py-4 border-b border-[var(--color-border)] font-mono text-xs lg:text-sm">
          <span className="text-[var(--color-text)]">{header}</span>
          {fileType && (
            <span className="text-[10px] lg:text-xs uppercase tracking-wide text-[var(--color-text-subtle)]">
              {fileType}
            </span>
          )}
        </div>
      )}
      <pre className="m-0 py-3 lg:py-5 overflow-x-auto leading-relaxed text-xs lg:text-sm" tabIndex={0}>
        <code>
          {lines.map((line: HighlightedLine) => (
            <div key={line.lineNumber} className="flex px-3 lg:px-5">
              <span
                className="w-7 lg:w-10 shrink-0 text-right pr-3 lg:pr-5 text-[var(--color-text-subtle)] select-none"
                aria-hidden="true"
              >
                {line.lineNumber}
              </span>
              <span className="flex-1 min-w-0">
                {line.nodes.map((node: HastNode, j: number) => hastChildToJsx(node, j))}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </figure>
  );
});
