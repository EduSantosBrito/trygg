/** @internal */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { Data, Effect } from "effect";

export class CheckConfigError extends Data.TaggedError("CheckConfigError")<{
  readonly message: string;
}> {}

export class CheckInternalError extends Data.TaggedError("CheckInternalError")<{
  readonly cause: unknown;
}> {}

export interface FixSuggestion {
  readonly description: string;
  readonly before: string;
  readonly after: string;
  readonly applicability?: "automatic" | "review" | "required-none";
}

export type DiagnosticConfidence = "exact" | "high" | "medium" | "unknown";

export interface RelatedLocation {
  readonly kind: "origin" | "component-path" | "candidate";
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface ProvenanceOrigin {
  readonly kind: "component" | "layer-input";
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export type ProvenancePathEntry =
  | {
      readonly kind: "component";
      readonly symbol: string;
      readonly file: string;
      readonly line: number;
    }
  | {
      readonly kind: "boundary";
      readonly symbol: "mount";
      readonly file: string;
      readonly line: number;
    };

export interface ProviderCandidate {
  readonly component: string;
  readonly file: string;
  readonly line: number;
  readonly lifetime: "per-mounted-instance" | "subtree" | "application";
  readonly rationale: string;
}

export interface RequirementProvenance {
  readonly service: string;
  readonly origin: ProvenanceOrigin;
  readonly path: ReadonlyArray<ProvenancePathEntry>;
  readonly candidates: ReadonlyArray<ProviderCandidate>;
}

export interface CheckDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly code: number;
  readonly stableCode: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly confidence: DiagnosticConfidence;
  readonly suppressible: boolean;
  readonly analysisIncomplete: boolean;
  readonly relatedLocations: ReadonlyArray<RelatedLocation>;
  readonly tryggCode?: string;
  readonly hint?: string;
  readonly technicalMessage?: string;
  readonly boundaryNote?: string;
  readonly fix?: FixSuggestion;
  readonly alternatives?: ReadonlyArray<string>;
  readonly sourceLine?: string;
  readonly provenance?: RequirementProvenance;
}

export interface CheckResult {
  readonly diagnostics: ReadonlyArray<CheckDiagnostic>;
  readonly summary: {
    readonly filesChecked: number;
    readonly errors: number;
    readonly warnings: number;
  };
}

export interface CheckOptions {
  readonly projectDir?: string;
  readonly tsconfigPath?: string;
}

export interface AnalyzeProjectOptions {
  readonly projectDir: string;
  readonly configPath: string;
  readonly parsedConfig: ts.ParsedCommandLine;
  readonly readFile?: (fileName: string) => string | undefined;
  readonly fileExists?: (fileName: string) => boolean;
  readonly version?: (fileName: string, text: string) => string;
  readonly oldProgram?: ts.Program;
}

export interface CheckAnalysis {
  readonly result: CheckResult;
  readonly program: ts.Program;
}

interface SourcePoint {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

interface ComponentNode {
  readonly symbol: string;
  readonly point: SourcePoint;
  readonly requirements: ReadonlyArray<{ readonly service: string; readonly point: SourcePoint }>;
  readonly renders: ReadonlyArray<RenderEdge>;
}

interface RenderEdge {
  readonly from: string;
  readonly to: string;
  readonly toKey: string;
  readonly rootKey: string;
  readonly point: SourcePoint;
}

interface ProviderBoundary {
  readonly alias: string;
  readonly layer: string;
  readonly component: string;
  readonly point: SourcePoint;
}

interface ComponentAlias extends ProviderBoundary {
  readonly layerKey: string;
  readonly componentKey: string;
}

interface RawLayer {
  readonly symbol: string;
  readonly kind: "make" | "provide" | "merge";
  readonly point: SourcePoint;
  readonly outputs: ReadonlyArray<string>;
  readonly inputs: ReadonlyArray<{ readonly service: string; readonly point: SourcePoint }>;
  readonly errors: ReadonlyArray<string>;
  readonly provider?: string;
  readonly target?: string;
  readonly left?: string;
  readonly right?: string;
}

interface LayerNode {
  readonly symbol: string;
  readonly kind: RawLayer["kind"];
  readonly point: SourcePoint;
  readonly outputs: ReadonlySet<string>;
  readonly inputs: ReadonlyMap<string, ReadonlyArray<ProvenanceOrigin>>;
  readonly errors: ReadonlySet<string>;
}

interface MountBoundary {
  readonly root?: string;
  readonly fileName: string;
  readonly point: SourcePoint;
  readonly endLine: number;
  readonly endColumn: number;
}

interface IncompleteLink {
  readonly point: SourcePoint;
  readonly message: string;
}

interface RequirementPath {
  readonly origin: ProvenanceOrigin;
  readonly components: ReadonlyArray<ComponentNode>;
}

type Demand = Map<string, RequirementPath[]>;

interface BoundaryAnalysis {
  readonly boundary: MountBoundary;
  readonly unresolved: ReadonlyMap<string, ReadonlyArray<RequirementProvenance>>;
  readonly incomplete?: IncompleteLink;
}

interface ProvenanceGraph {
  readonly components: ReadonlyMap<string, ComponentNode>;
  readonly renderEdges: ReadonlyArray<RenderEdge>;
  readonly requirements: ReadonlyArray<{ readonly component: string; readonly service: string; readonly point: SourcePoint }>;
  readonly providers: ReadonlyArray<ProviderBoundary>;
  readonly layers: ReadonlyMap<string, LayerNode>;
  readonly mounts: ReadonlyArray<MountBoundary>;
  readonly boundaries: ReadonlyArray<BoundaryAnalysis>;
}

const pointFor = (source: ts.SourceFile, node: ts.Node): SourcePoint => {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: path.relative(process.cwd(), source.fileName),
    line: line + 1,
    column: character + 1,
  };
};

const entityName = (node: ts.Node | undefined): string | undefined => {
  if (!node) return undefined;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isQualifiedName(node)) return node.right.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return undefined;
};

const jsxTagName = (node: ts.JsxTagNameExpression): string | undefined => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const owner = jsxTagName(node.expression);
    return owner ? `${owner}.${node.name.text}` : node.name.text;
  }
  if (ts.isJsxNamespacedName(node)) return `${node.namespace.text}:${node.name.text}`;
  return undefined;
};

const typeNames = (node: ts.TypeNode | undefined): string[] => {
  if (!node || node.kind === ts.SyntaxKind.NeverKeyword) return [];
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(typeNames);
  if (ts.isParenthesizedTypeNode(node)) return typeNames(node.type);
  if (ts.isTypeReferenceNode(node)) {
    const name = entityName(node.typeName);
    return name ? [name] : [];
  }
  return [];
};

const propertyName = (expression: ts.Expression, owner: string, member: string): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === owner &&
  expression.name.text === member;

const arrayMetadata = (object: ts.ObjectLiteralExpression | undefined, key: string): string[] => {
  if (!object) return [];
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && entityName(candidate.name) === key,
  );
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.flatMap((element) => {
    const name = entityName(element);
    return name ? [name] : [];
  });
};

const addDemand = (demand: Demand, service: string, requirementPath: RequirementPath): void => {
  const paths = demand.get(service);
  if (paths) paths.push(requirementPath);
  else demand.set(service, [requirementPath]);
};

const cloneDemand = (demand: Demand): Demand =>
  new Map([...demand].map(([service, paths]) => [service, [...paths]]));

function buildProvenanceGraph(
  fileNames: ReadonlyArray<string>,
  readFile: (fileName: string) => string | undefined,
): ProvenanceGraph {
  const components = new Map<string, ComponentNode>();
  const aliases = new Map<string, ComponentAlias>();
  const rawLayers = new Map<string, RawLayer>();
  const localDeclarations = new Set<string>();
  const importedDeclarations = new Set<string>();
  const mounts: MountBoundary[] = [];
  const renderEdges: RenderEdge[] = [];
  const requirements: Array<{ component: string; service: string; point: SourcePoint }> = [];
  const providers: ProviderBoundary[] = [];

  for (const fileName of fileNames.filter((name) => name.endsWith(".tsx"))) {
    const text = readFile(fileName);
    if (text === undefined) continue;
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const qualify = (symbol: string): string => `${source.fileName}::${symbol}`;

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && node.importClause) {
        if (node.importClause.name) importedDeclarations.add(qualify(node.importClause.name.text));
        const bindings = node.importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          importedDeclarations.add(qualify(bindings.name.text));
        } else if (bindings) {
          for (const element of bindings.elements) {
            importedDeclarations.add(qualify(element.name.text));
          }
        }
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const symbol = node.name.text;
        const initializer = node.initializer;
        localDeclarations.add(qualify(symbol));

        if (
          ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          initializer.expression.text === "gen"
        ) {
          const callback = initializer.arguments[0];
          if (callback && (ts.isFunctionExpression(callback) || ts.isArrowFunction(callback))) {
            const ownRequirements: Array<{ service: string; point: SourcePoint }> = [];
            const renders: RenderEdge[] = [];

            const scanCallback = (child: ts.Node): void => {
              if (ts.isTypeReferenceNode(child) && entityName(child.typeName) === "RequiresService") {
                for (const service of typeNames(child.typeArguments?.[0])) {
                  const serviceNode = child.typeArguments?.[0] ?? child;
                  const requirement = { service, point: pointFor(source, serviceNode) };
                  ownRequirements.push(requirement);
                  requirements.push({ component: symbol, ...requirement });
                }
              }
              if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
                const target = jsxTagName(child.tagName);
                const componentName = target?.split(".").at(-1);
                if (target && componentName && /^[A-Z]/.test(componentName)) {
                  const edge = {
                    from: symbol,
                    to: target,
                    toKey: qualify(target),
                    rootKey: qualify(target.split(".")[0] ?? target),
                    point: pointFor(source, child.tagName),
                  };
                  renders.push(edge);
                  renderEdges.push(edge);
                }
              }
              ts.forEachChild(child, scanCallback);
            };
            scanCallback(callback);
            components.set(qualify(symbol), {
              symbol,
              point: pointFor(source, node.name),
              requirements: ownRequirements,
              renders,
            });
          }
        } else if (
          ts.isCallExpression(initializer) &&
          ts.isCallExpression(initializer.expression) &&
          ts.isIdentifier(initializer.expression.expression) &&
          initializer.expression.expression.text === "provide"
        ) {
          const layer = entityName(initializer.expression.arguments[0]);
          const component = entityName(initializer.arguments[0]);
          if (layer && component) {
            const provider: ComponentAlias = {
              alias: symbol,
              layer,
              component,
              layerKey: qualify(layer),
              componentKey: qualify(component),
              point: pointFor(source, node.name),
            };
            aliases.set(qualify(symbol), provider);
            providers.push(provider);
          }
        } else if (ts.isCallExpression(initializer) && propertyName(initializer.expression, "Layer", "make")) {
          const metadata = initializer.arguments[0];
          const object = metadata && ts.isObjectLiteralExpression(metadata) ? metadata : undefined;
          const outputTypes = typeNames(initializer.typeArguments?.[0]);
          const inputTypeNode = initializer.typeArguments?.[2];
          const inputNames = typeNames(inputTypeNode);
          rawLayers.set(qualify(symbol), {
            symbol,
            kind: "make",
            point: pointFor(source, node.name),
            outputs: outputTypes.length > 0 ? outputTypes : arrayMetadata(object, "outputs"),
            inputs: inputNames.map((service) => ({
              service,
              point: pointFor(source, inputTypeNode ?? node.name),
            })),
            errors: typeNames(initializer.typeArguments?.[1]).length > 0
              ? typeNames(initializer.typeArguments?.[1])
              : arrayMetadata(object, "errors"),
          });
        } else if (
          ts.isCallExpression(initializer) &&
          ts.isCallExpression(initializer.expression) &&
          propertyName(initializer.expression.expression, "Layer", "provide")
        ) {
          const provider = entityName(initializer.expression.arguments[0]);
          const target = entityName(initializer.arguments[0]);
          if (provider && target) {
            rawLayers.set(qualify(symbol), {
              symbol,
              kind: "provide",
              point: pointFor(source, node.name),
              outputs: [],
              inputs: [],
              errors: [],
              provider: qualify(provider),
              target: qualify(target),
            });
          }
        } else if (ts.isCallExpression(initializer) && propertyName(initializer.expression, "Layer", "merge")) {
          const left = entityName(initializer.arguments[0]);
          const right = entityName(initializer.arguments[1]);
          if (left && right) {
            rawLayers.set(qualify(symbol), {
              symbol,
              kind: "merge",
              point: pointFor(source, node.name),
              outputs: [],
              inputs: [],
              errors: [],
              left: qualify(left),
              right: qualify(right),
            });
          }
        }
      }

      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "mount"
      ) {
        const element = node.arguments[1];
        if (element) {
          const opening = ts.isJsxElement(element)
            ? element.openingElement
            : ts.isJsxSelfClosingElement(element)
              ? element
              : undefined;
          const point = pointFor(source, element);
          const end = source.getLineAndCharacterOfPosition(element.getEnd());
          const root = opening ? entityName(opening.tagName) : undefined;
          mounts.push({
            ...(root ? { root: qualify(root) } : {}),
            fileName: source.fileName,
            point,
            endLine: end.line + 1,
            endColumn: end.character + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const layers = new Map<string, LayerNode>();
  const resolveLayer = (symbol: string, resolving = new Set<string>()): LayerNode | undefined => {
    const cached = layers.get(symbol);
    if (cached) return cached;
    const raw = rawLayers.get(symbol);
    if (!raw || resolving.has(symbol)) return undefined;
    const nextResolving = new Set(resolving).add(symbol);

    let layer: LayerNode;
    if (raw.kind === "make") {
      const inputs = new Map<string, ProvenanceOrigin[]>();
      for (const input of raw.inputs) {
        const origin: ProvenanceOrigin = {
          kind: "layer-input",
          symbol: raw.symbol,
          ...input.point,
        };
        const origins = inputs.get(input.service);
        if (origins) origins.push(origin);
        else inputs.set(input.service, [origin]);
      }
      layer = {
        symbol,
        kind: raw.kind,
        point: raw.point,
        outputs: new Set(raw.outputs),
        inputs,
        errors: new Set(raw.errors),
      };
    } else {
      const left = resolveLayer(
        raw.kind === "provide" ? raw.provider! : raw.left!,
        nextResolving,
      );
      const right = resolveLayer(
        raw.kind === "provide" ? raw.target! : raw.right!,
        nextResolving,
      );
      if (!left || !right) return undefined;

      const inputs = new Map<string, ProvenanceOrigin[]>();
      const copyInputs = (source: ReadonlyMap<string, ReadonlyArray<ProvenanceOrigin>>): void => {
        for (const [service, origins] of source) {
          const current = inputs.get(service);
          if (current) current.push(...origins);
          else inputs.set(service, [...origins]);
        }
      };
      copyInputs(left.inputs);
      for (const [service, origins] of right.inputs) {
        if (raw.kind === "provide" && left.outputs.has(service)) continue;
        const current = inputs.get(service);
        if (current) current.push(...origins);
        else inputs.set(service, [...origins]);
      }
      layer = {
        symbol,
        kind: raw.kind,
        point: raw.point,
        outputs: raw.kind === "provide"
          ? new Set(right.outputs)
          : new Set([...left.outputs, ...right.outputs]),
        inputs,
        errors: new Set([...left.errors, ...right.errors]),
      };
    }
    layers.set(symbol, layer);
    return layer;
  };
  for (const symbol of rawLayers.keys()) resolveLayer(symbol);

  const rootComponent = (symbol: string, seen = new Set<string>()): ComponentNode | undefined => {
    if (seen.has(symbol)) return undefined;
    const component = components.get(symbol);
    if (component) return component;
    const alias = aliases.get(symbol);
    return alias ? rootComponent(alias.componentKey, new Set(seen).add(symbol)) : undefined;
  };

  const evaluate = (
    symbol: string,
    incomplete: IncompleteLink[],
    stack = new Set<string>(),
  ): Demand => {
    if (stack.has(symbol)) return new Map();
    const nextStack = new Set(stack).add(symbol);
    const alias = aliases.get(symbol);
    if (alias) {
      if (!components.has(alias.componentKey) && !aliases.has(alias.componentKey)) {
        incomplete.push({
          point: alias.point,
          message: `Provided component ${alias.component} could not be resolved by provenance analysis.`,
        });
      }
      const demand = evaluate(alias.componentKey, incomplete, nextStack);
      const layer = layers.get(alias.layerKey);
      if (!layer) {
        incomplete.push({
          point: alias.point,
          message: `Provider layer ${alias.layer} could not be resolved by provenance analysis.`,
        });
        return demand;
      }
      for (const output of layer.outputs) demand.delete(output);
      const boundaryComponent = rootComponent(alias.componentKey);
      if (boundaryComponent) {
        for (const [service, origins] of layer.inputs) {
          for (const origin of origins) {
            addDemand(demand, service, { origin, components: [boundaryComponent] });
          }
        }
      }
      return demand;
    }

    const component = components.get(symbol);
    if (!component) return new Map();
    const demand: Demand = new Map();
    for (const requirement of component.requirements) {
      addDemand(demand, requirement.service, {
        origin: { kind: "component", symbol: component.symbol, ...requirement.point },
        components: [component],
      });
    }
    for (const edge of component.renders) {
      if (!components.has(edge.toKey) && !aliases.has(edge.toKey)) {
        if (
          localDeclarations.has(edge.toKey) ||
          importedDeclarations.has(edge.toKey) ||
          importedDeclarations.has(edge.rootKey)
        ) {
          incomplete.push({
            point: edge.point,
            message: `JSX component ${edge.to} could not be resolved by provenance analysis.`,
          });
        }
        continue;
      }
      const childDemand = cloneDemand(evaluate(edge.toKey, incomplete, nextStack));
      for (const [service, paths] of childDemand) {
        for (const requirementPath of paths) {
          const last = requirementPath.components.at(-1);
          addDemand(demand, service, {
            ...requirementPath,
            components: last?.symbol === component.symbol
              ? requirementPath.components
              : [...requirementPath.components, component],
          });
        }
      }
    }
    return demand;
  };

  const boundaries: BoundaryAnalysis[] = mounts.map((boundary) => {
    const incomplete: IncompleteLink[] = [];
    let demand: Demand;
    if (!boundary.root || (!components.has(boundary.root) && !aliases.has(boundary.root))) {
      incomplete.push({
        point: boundary.point,
        message: "The mounted root is dynamic or could not be resolved by provenance analysis.",
      });
      demand = new Map();
    } else {
      demand = evaluate(boundary.root, incomplete);
    }
    const unresolved = new Map<string, RequirementProvenance[]>();
    for (const [service, paths] of demand) {
      unresolved.set(
        service,
        paths.map((requirementPath) => {
          const componentPath = requirementPath.components.filter(
            (component, index, all) => all.findIndex((other) => other.symbol === component.symbol) === index,
          );
          const candidates = componentPath.map((component, index): ProviderCandidate => {
            const isFirst = index === 0;
            const isLast = index === componentPath.length - 1;
            return {
              component: component.symbol,
              file: component.point.file,
              line: component.point.line,
              lifetime: isLast ? "application" : isFirst ? "per-mounted-instance" : "subtree",
              rationale: isLast
                ? "Shares the provider for this mounted application."
                : isFirst
                  ? "Limits the provider to each mounted instance of the requiring subtree."
                  : "Shares the provider across this component subtree without promoting it to the application root.",
            };
          });
          return {
            service,
            origin: requirementPath.origin,
            path: [
              ...componentPath.map((component): ProvenancePathEntry => ({
                kind: "component",
                symbol: component.symbol,
                file: component.point.file,
                line: component.point.line,
              })),
              {
                kind: "boundary",
                symbol: "mount",
                file: boundary.point.file,
                line: boundary.point.line,
              },
            ],
            candidates,
          };
        }),
      );
    }
    return { boundary, unresolved, ...(incomplete[0] ? { incomplete: incomplete[0] } : {}) };
  });

  return { components, renderEdges, requirements, providers, layers, mounts, boundaries };
}

interface Lowered {
  readonly code: string;
}

const JSX_IDENT = "__trygg_jsx";
const JSXS_IDENT = "__trygg_jsxs";

function lowerTsx(fileName: string, text: string, runtimeSpec: string): Lowered {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const replacements: Array<{ readonly start: number; readonly end: number; readonly text: string }> = [];

  const childToExpression = (child: ts.JsxChild): ts.Expression => {
    if (ts.isJsxText(child)) return ts.factory.createStringLiteral(child.text.trim());
    if (ts.isJsxExpression(child)) return child.expression ?? ts.factory.createTrue();
    return ts.factory.createIdentifier("__trygg_nested_jsx_unsupported");
  };

  const buildCall = (node: ts.JsxElement | ts.JsxSelfClosingElement): ts.CallExpression | undefined => {
    const open = ts.isJsxSelfClosingElement(node) ? node : node.openingElement;
    const tagName = open.tagName;
    const typeArg: ts.Expression = ts.isIdentifier(tagName)
      ? /^[a-z]/.test(tagName.text)
        ? ts.factory.createStringLiteral(tagName.text)
        : tagName
      : ts.isJsxNamespacedName(tagName)
        ? ts.factory.createStringLiteral(`${tagName.namespace.text}:${tagName.name.text}`)
        : tagName;
    const properties = open.attributes.properties.filter(ts.isJsxAttribute);
    if (properties.length !== open.attributes.properties.length) return undefined;
    const propsArg: ts.Expression = properties.length > 0
      ? ts.factory.createObjectLiteralExpression(
          properties.map((property) =>
            ts.factory.createPropertyAssignment(
              ts.isIdentifier(property.name)
                ? property.name
                : ts.factory.createStringLiteral(
                    `${property.name.namespace.text}:${property.name.name.text}`,
                  ),
              property.initializer ?? ts.factory.createTrue(),
            ),
          ),
        )
      : ts.factory.createNull();
    let fn = JSX_IDENT;
    const args: ts.Expression[] = [typeArg, propsArg];
    if (ts.isJsxElement(node)) {
      const children = node.children.filter((child) => !(ts.isJsxText(child) && child.text.trim() === ""));
      if (children.length > 0) {
        fn = JSXS_IDENT;
        args.push(ts.factory.createArrayLiteralExpression(children.map(childToExpression)));
      }
    }
    return ts.factory.createCallExpression(ts.factory.createIdentifier(fn), undefined, args);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const call = buildCall(node);
      if (call) {
        replacements.push({
          start: node.getStart(source),
          end: node.getEnd(),
          text: printer.printNode(ts.EmitHint.Expression, call, source),
        });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  if (replacements.length === 0) return { code: text };
  let code = text;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    code = code.slice(0, replacement.start) + replacement.text + code.slice(replacement.end);
  }
  code += `\nimport { jsx as ${JSX_IDENT}, jsxs as ${JSXS_IDENT} } from "${runtimeSpec}";\n`;
  return { code };
}

const FRAMEWORK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runtimeSpecFor = (fileName: string, jsxImportSource?: string): string => {
  if (jsxImportSource) {
    const source = jsxImportSource.replace(/\/$/, "");
    return source.startsWith(".") ? `${source}/jsx-runtime.js` : `${source}/jsx-runtime`;
  }
  let relative = path.relative(path.dirname(fileName), FRAMEWORK_DIR).split(path.sep).join("/");
  if (relative === "" || relative === ".") return "./jsx-runtime.js";
  if (!relative.startsWith("./")) relative = `./${relative}`;
  return `${relative}/jsx-runtime.js`;
};

const canonicalPath = (fileName: string): string => path.resolve(fileName);

const relatedLocationsFor = (provenance: RequirementProvenance): ReadonlyArray<RelatedLocation> => [
  {
    kind: "origin",
    message: `${provenance.origin.symbol} introduces the ${provenance.service} requirement.`,
    file: provenance.origin.file,
    line: provenance.origin.line,
    column: provenance.origin.column,
  },
  ...provenance.path
    .filter((entry): entry is Extract<ProvenancePathEntry, { readonly kind: "component" }> =>
      entry.kind === "component"
    )
    .map((entry): RelatedLocation => ({
      kind: "component-path",
      message: `${provenance.service} propagates through ${entry.symbol}.`,
      file: entry.file,
      line: entry.line,
      column: 1,
    })),
  ...provenance.candidates.map((candidate): RelatedLocation => ({
    kind: "candidate",
    message: `${candidate.component} is a possible ${candidate.lifetime} provider scope.`,
    file: candidate.file,
    line: candidate.line,
    column: 1,
  })),
];

export interface ResolvedProjectConfig {
  readonly projectDir: string;
  readonly configPath: string;
  readonly parsedConfig: ts.ParsedCommandLine;
}

export const loadProjectConfig = (
  options: CheckOptions = {},
  readFile: (fileName: string) => string | undefined = ts.sys.readFile,
  fileExists: (fileName: string) => boolean = ts.sys.fileExists,
): Effect.Effect<ResolvedProjectConfig, CheckConfigError | CheckInternalError> =>
  Effect.gen(function* () {
    const projectDir = path.resolve(options.projectDir ?? process.cwd());
    let configPath: string | undefined;
    if (options.tsconfigPath) {
      const fromWorkingDirectory = path.resolve(options.tsconfigPath);
      const fromProject = path.resolve(projectDir, options.tsconfigPath);
      configPath = fileExists(fromWorkingDirectory)
        ? fromWorkingDirectory
        : fileExists(fromProject)
          ? fromProject
          : undefined;
    } else {
      configPath = ts.findConfigFile(projectDir, fileExists, "tsconfig.json");
    }
    if (!configPath) {
      return yield* new CheckConfigError({
        message: `tsconfig.json was not found in ${projectDir} or its parent directories`,
      });
    }

    const configFile = yield* Effect.try({
      try: () => ts.readConfigFile(configPath, readFile),
      catch: (cause) => new CheckInternalError({ cause }),
    });
    if (configFile.error) {
      return yield* new CheckConfigError({
        message: ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
      });
    }
    const parsedConfig = yield* Effect.try({
      try: () =>
        ts.parseJsonConfigFileContent(
          configFile.config,
          { ...ts.sys, readFile, fileExists },
          path.dirname(configPath),
          undefined,
          configPath,
        ),
      catch: (cause) => new CheckInternalError({ cause }),
    });
    return { projectDir, configPath, parsedConfig };
  });

const SOURCE_INPUT = Symbol("mini-check-source-input");
const SOURCE_VERSION = Symbol("mini-check-source-version");
type ReusableSourceFile = ts.SourceFile & {
  [SOURCE_INPUT]?: string;
  [SOURCE_VERSION]?: string;
};

const scriptKindFor = (fileName: string): ts.ScriptKind => {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  if (fileName.endsWith(".json")) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
};

export const analyzeProject = (
  options: AnalyzeProjectOptions,
): Effect.Effect<CheckAnalysis, CheckInternalError> =>
  Effect.try({
    try: () => {
      const readFile = options.readFile ?? ts.sys.readFile;
      const fileExists = options.fileExists ?? ts.sys.fileExists;
      const parsed = options.parsedConfig;
      const graph = buildProvenanceGraph(parsed.fileNames, readFile);
      const host = ts.createCompilerHost(parsed.options);
      host.readFile = readFile;
      host.fileExists = fileExists;
      host.getSourceFile = (fileName, languageVersionOrOptions, onError) => {
        const text = readFile(fileName);
        if (text === undefined) {
          onError?.(`File not found: ${fileName}`);
          return undefined;
        }
        const version = options.version?.(fileName, text) ?? text;
        const oldSource = options.oldProgram?.getSourceFile(fileName) as ReusableSourceFile | undefined;
        if (oldSource?.[SOURCE_INPUT] === text && oldSource[SOURCE_VERSION] === version) {
          return oldSource;
        }
        const code = fileName.endsWith(".tsx")
          ? lowerTsx(fileName, text, runtimeSpecFor(fileName, parsed.options.jsxImportSource)).code
          : text;
        const source = ts.createSourceFile(
          fileName,
          code,
          languageVersionOrOptions,
          true,
          scriptKindFor(fileName),
        ) as ReusableSourceFile;
        source[SOURCE_INPUT] = text;
        source[SOURCE_VERSION] = version;
        return source;
      };

      const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        host,
        ...(options.oldProgram ? { oldProgram: options.oldProgram } : {}),
      });
      const diagnostics: CheckDiagnostic[] = [];
      const unresolvedFiles = new Set(
        graph.boundaries
          .filter((boundary) => boundary.unresolved.size > 0)
          .map((boundary) => canonicalPath(boundary.boundary.fileName)),
      );
      const requirementCompilerMessages = new Map<string, string>();

      for (const diagnostic of [
        ...program.getSyntacticDiagnostics(),
        ...program.getSemanticDiagnostics(),
      ]) {
        if (!diagnostic.file) continue;
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        const diagnosticFile = canonicalPath(diagnostic.file.fileName);
        if (
          diagnostic.code === 2345 &&
          message.includes("__requirements") &&
          unresolvedFiles.has(diagnosticFile)
        ) {
          requirementCompilerMessages.set(diagnosticFile, message);
          continue;
        }
        const start = diagnostic.start ?? 0;
        const startPoint = diagnostic.file.getLineAndCharacterOfPosition(start);
        const endPoint = diagnostic.file.getLineAndCharacterOfPosition(start + (diagnostic.length ?? 0));
        const line = startPoint.line + 1;
        const originalText = readFile(diagnostic.file.fileName);
        const sourceLine = originalText?.split("\n")[line - 1];
        const stableCode = `TS${diagnostic.code}`;
        diagnostics.push({
          file: path.relative(process.cwd(), diagnostic.file.fileName),
          line,
          column: startPoint.character + 1,
          ...(endPoint.line !== startPoint.line || endPoint.character !== startPoint.character
            ? { endLine: endPoint.line + 1, endColumn: endPoint.character + 1 }
            : {}),
          code: diagnostic.code,
          stableCode,
          severity: diagnostic.reportsDeprecated ? "warning" : "error",
          message,
          confidence: diagnostic.file.fileName.endsWith(".tsx") ? "medium" : "exact",
          suppressible: true,
          analysisIncomplete: false,
          relatedLocations: [],
          ...(sourceLine !== undefined ? { sourceLine } : {}),
        });
      }

      for (const analysis of graph.boundaries) {
        const boundary = analysis.boundary;
        const sourceLine = readFile(boundary.fileName)?.split("\n")[boundary.point.line - 1];
        const technicalMessage = requirementCompilerMessages.get(canonicalPath(boundary.fileName));
        for (const [service, paths] of analysis.unresolved) {
          for (const provenance of paths) {
            diagnostics.push({
              file: boundary.point.file,
              line: boundary.point.line,
              column: boundary.point.column,
              endLine: boundary.endLine,
              endColumn: boundary.endColumn,
              code: 2345,
              stableCode: "TRYGG0001",
              tryggCode: "TRYGG0001",
              severity: "error",
              message: `Application boundary has an unsatisfied service requirement: ${service}.`,
              confidence: "exact",
              suppressible: false,
              analysisIncomplete: false,
              relatedLocations: relatedLocationsFor(provenance),
              boundaryNote:
                "The error is reported at mount because mount closes the requirement graph; it does not determine provider ownership.",
              ...(technicalMessage ? { technicalMessage } : {}),
              ...(sourceLine !== undefined ? { sourceLine } : {}),
              provenance,
            });
          }
        }
        if (analysis.incomplete) {
          diagnostics.push({
            file: analysis.incomplete.point.file,
            line: analysis.incomplete.point.line,
            column: analysis.incomplete.point.column,
            code: 901,
            stableCode: "TRYGG0901",
            tryggCode: "TRYGG0901",
            severity: "warning",
            message: analysis.incomplete.message,
            confidence: "unknown",
            suppressible: true,
            analysisIncomplete: true,
            relatedLocations: [],
            ...(readFile(boundary.fileName)?.split("\n")[analysis.incomplete.point.line - 1] !== undefined
              ? {
                  sourceLine: readFile(boundary.fileName)?.split("\n")[analysis.incomplete.point.line - 1],
                }
              : {}),
          });
        }
      }

      diagnostics.sort((left, right) =>
        left.file.localeCompare(right.file) || left.line - right.line || left.message.localeCompare(right.message)
      );
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
      return {
        program,
        result: {
          diagnostics,
          summary: {
            filesChecked: parsed.fileNames.length,
            errors,
            warnings: diagnostics.length - errors,
          },
        },
      };
    },
    catch: (cause) => new CheckInternalError({ cause }),
  });

export const checkProject = (
  options: CheckOptions = {},
): Effect.Effect<CheckResult, CheckConfigError | CheckInternalError> =>
  Effect.gen(function* () {
    const config = yield* loadProjectConfig(options);
    const analysis = yield* analyzeProject({
      projectDir: config.projectDir,
      configPath: config.configPath,
      parsedConfig: config.parsedConfig,
    });
    return analysis.result;
  });
