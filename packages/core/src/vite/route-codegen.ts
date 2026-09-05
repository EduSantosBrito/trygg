/**
 * TypeScript-backed route declaration codegen.
 *
 * @remarks
 * Route schemas are read from the source AST and resolved through TypeScript's
 * checker. Generated parameter types therefore come from each Schema's `Type`
 * member rather than a parallel text-to-type mapping.
 *
 * @internal
 * @since 1.0.0
 */
import * as nodePath from "node:path";
import { Effect, Result } from "effect";
import * as ts from "typescript";
import { PluginParseError } from "./errors.js";

export interface ParsedRoute {
  readonly path: string;
  readonly paramsType: string | undefined;
  readonly paramsInputType: string | undefined;
  readonly queryType: string | undefined;
  readonly queryInputType: string | undefined;
  readonly children: ReadonlyArray<ParsedRoute>;
  readonly isIndex: boolean;
}

interface RouteCallRecord {
  readonly call: ts.CallExpression;
  readonly terminal: ts.CallExpression;
  readonly kind: "make" | "index";
  readonly methods: ReadonlyArray<ts.CallExpression>;
}

interface CompilerContext {
  readonly checker: ts.TypeChecker;
  readonly compilerOptions: ts.CompilerOptions;
  readonly host: ts.CompilerHost;
  readonly program: ts.Program;
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
  readonly declarationPath: string;
  readonly routeFactorySymbol: ts.Symbol;
  readonly routeBuilderType: ts.Type;
  readonly routeSchemaType: ts.Type;
  readonly pathParamInputType: ts.Type;
  readonly queryParamInputType: ts.Type;
}

const flattenDiagnostic = (diagnostic: ts.Diagnostic): string =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

const parseError = (description: string, input: unknown): PluginParseError =>
  new PluginParseError({ description, input });

const defaultCompilerOptions: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
};

const contractSource = `import type { Schema } from "effect"
import { Route as routeFactory } from "trygg/router"
import type { AnyRouteBuilder } from "trygg/router"
export { routeFactory }
export declare const routeBuilder: AnyRouteBuilder
export declare const routeSchema: Schema.Struct<Schema.Struct.Fields>
export declare const pathParamInput: string
export declare const queryParamInput: string | undefined
`;

const resolveAliasedSymbol = (
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Symbol | undefined => {
  let current = symbol;
  const visited = new Set<ts.Symbol>();
  while (
    current !== undefined &&
    (current.flags & ts.SymbolFlags.Alias) !== 0 &&
    !visited.has(current)
  ) {
    visited.add(current);
    const target = checker.getAliasedSymbol(current);
    if (target === current) break;
    current = target;
  }
  return current;
};

const symbolOfContractImport = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  name: string,
): ts.Symbol | undefined => {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.name.text === name) {
        return resolveAliasedSymbol(checker, checker.getSymbolAtLocation(element.name));
      }
    }
  }
  return undefined;
};

const typeOfContractBinding = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  name: string,
): ts.Type | undefined => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return checker.getTypeAtLocation(declaration.name);
      }
    }
  }
  return undefined;
};

const loadCompilerOptions = Effect.fn("RouteCodegen.loadCompilerOptions")(function* (
  sourcePath: string,
) {
  const loaded = yield* Effect.try({
    try: () => {
      const configPath = ts.findConfigFile(
        nodePath.dirname(sourcePath),
        ts.sys.fileExists,
        "tsconfig.json",
      );
      if (configPath === undefined) {
        return { options: defaultCompilerOptions, diagnostics: [] };
      }

      const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
      if (configFile.error !== undefined) {
        return { options: defaultCompilerOptions, diagnostics: [configFile.error] };
      }

      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        nodePath.dirname(configPath),
        undefined,
        configPath,
      );
      return { options: parsed.options, diagnostics: parsed.errors };
    },
    catch: (cause) =>
      parseError("Failed to load TypeScript configuration for route codegen", {
        sourcePath,
        cause,
      }),
  });

  const diagnostic = loaded.diagnostics.find(
    (candidate) => candidate.category === ts.DiagnosticCategory.Error,
  );
  if (diagnostic !== undefined) {
    return yield* parseError(
      `Cannot generate route declarations: ${flattenDiagnostic(diagnostic)}`,
      { sourcePath, code: diagnostic.code },
    );
  }

  return loaded.options;
});

const makeCompilerContext = Effect.fn("RouteCodegen.makeCompilerContext")(function* (
  source: string,
  sourcePathInput: string,
  declarationPathInput: string,
) {
  const sourcePath = nodePath.resolve(sourcePathInput);
  const declarationPath = nodePath.resolve(declarationPathInput);
  const contractPath = `${sourcePath}.trygg-route-codegen-contract.ts`;
  const compilerOptions = yield* loadCompilerOptions(sourcePath);
  const baseHost = ts.createCompilerHost(compilerOptions);
  const isSource = (fileName: string): boolean => nodePath.resolve(fileName) === sourcePath;
  const isContract = (fileName: string): boolean => nodePath.resolve(fileName) === contractPath;
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (fileName) =>
      isSource(fileName) || isContract(fileName) || baseHost.fileExists(fileName),
    readFile: (fileName) =>
      isSource(fileName)
        ? source
        : isContract(fileName)
          ? contractSource
          : baseHost.readFile(fileName),
    getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
      if (isSource(fileName) || isContract(fileName)) {
        return ts.createSourceFile(
          fileName,
          isSource(fileName) ? source : contractSource,
          languageVersionOrOptions,
          true,
          ts.ScriptKind.TS,
        );
      }
      return baseHost.getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile,
      );
    },
  };

  const program = yield* Effect.try({
    try: () =>
      ts.createProgram({
        rootNames: [sourcePath, contractPath],
        options: compilerOptions,
        host,
      }),
    catch: (cause) =>
      parseError("Failed to create the TypeScript program for route codegen", {
        sourcePath,
        cause,
      }),
  });
  const sourceFile = program.getSourceFile(sourcePath);
  if (sourceFile === undefined) {
    return yield* parseError("TypeScript did not load the route source file", { sourcePath });
  }
  const contractFile = program.getSourceFile(contractPath);
  if (contractFile === undefined) {
    return yield* parseError("TypeScript did not load the route Schema contract", { sourcePath });
  }

  const syntaxDiagnostic = program
    .getSyntacticDiagnostics(sourceFile)
    .find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxDiagnostic !== undefined) {
    return yield* parseError(`Cannot parse routes: ${flattenDiagnostic(syntaxDiagnostic)}`, {
      sourcePath,
      code: syntaxDiagnostic.code,
    });
  }

  const contractDiagnostic = program
    .getSemanticDiagnostics(contractFile)
    .find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (contractDiagnostic !== undefined) {
    return yield* parseError(
      `Cannot resolve the installed route Schema contract: ${flattenDiagnostic(contractDiagnostic)}`,
      { sourcePath, code: contractDiagnostic.code },
    );
  }

  const checker = program.getTypeChecker();
  const routeFactorySymbol = symbolOfContractImport(checker, contractFile, "routeFactory");
  const routeBuilderType = typeOfContractBinding(checker, contractFile, "routeBuilder");
  const routeSchemaType = typeOfContractBinding(checker, contractFile, "routeSchema");
  const pathParamInputType = typeOfContractBinding(checker, contractFile, "pathParamInput");
  const queryParamInputType = typeOfContractBinding(checker, contractFile, "queryParamInput");
  if (
    routeFactorySymbol === undefined ||
    routeBuilderType === undefined ||
    routeSchemaType === undefined ||
    pathParamInputType === undefined ||
    queryParamInputType === undefined
  ) {
    return yield* parseError("TypeScript did not resolve the route Schema contract", {
      sourcePath,
    });
  }

  return {
    checker,
    compilerOptions,
    host,
    program,
    sourceFile,
    sourcePath,
    declarationPath,
    routeFactorySymbol,
    routeBuilderType,
    routeSchemaType,
    pathParamInputType,
    queryParamInputType,
  } satisfies CompilerContext;
});

interface RouteCallChain {
  readonly call: ts.CallExpression;
  readonly terminal: ts.CallExpression;
  readonly kind: "make" | "index";
  readonly methods: ReadonlyArray<ts.CallExpression>;
}

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const staticElementAccessName = (
  context: CompilerContext,
  expression: ts.ElementAccessExpression,
): string | undefined => {
  const argument = expression.argumentExpression;
  if (argument === undefined) return undefined;
  const type = context.checker.getTypeAtLocation(argument);
  return type.isStringLiteral() ? type.value : undefined;
};

interface CallMember {
  readonly receiver: ts.Expression;
  readonly name: string | undefined;
  readonly computed: boolean;
}

const callMember = (context: CompilerContext, call: ts.CallExpression): CallMember | undefined => {
  const expression = unwrapExpression(call.expression);
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: expression.expression, name: expression.name.text, computed: false };
  }
  if (ts.isElementAccessExpression(expression)) {
    return {
      receiver: expression.expression,
      name: staticElementAccessName(context, expression),
      computed: true,
    };
  }
  return undefined;
};

const methodName = (context: CompilerContext, call: ts.CallExpression): string | undefined =>
  callMember(context, call)?.name;

const constInitializer = (
  context: CompilerContext,
  identifier: ts.Identifier,
): { readonly symbol: ts.Symbol; readonly initializer: ts.Expression } | undefined => {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return undefined;
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      return { symbol, initializer: declaration.initializer };
    }
  }
  return undefined;
};

const symbolAtExpression = (
  context: CompilerContext,
  expression: ts.Expression,
): ts.Symbol | undefined => {
  const current = unwrapExpression(expression);
  let symbol: ts.Symbol | undefined;
  if (ts.isPropertyAccessExpression(current)) {
    symbol = context.checker.getSymbolAtLocation(current.name);
  } else if (ts.isElementAccessExpression(current)) {
    const name = staticElementAccessName(context, current);
    if (name !== undefined) {
      symbol = context.checker.getPropertyOfType(
        context.checker.getTypeAtLocation(current.expression),
        name,
      );
    }
    symbol ??= context.checker.getSymbolAtLocation(current);
  } else {
    symbol = context.checker.getSymbolAtLocation(current);
  }
  return resolveAliasedSymbol(context.checker, symbol);
};

const isRouteNamespaceOwner = (
  context: CompilerContext,
  expression: ts.Expression,
  visiting: Set<ts.Symbol> = new Set(),
): boolean => {
  const current = unwrapExpression(expression);
  if (!ts.isIdentifier(current)) return false;

  const symbol = context.checker.getSymbolAtLocation(current);
  if (symbol === undefined || visiting.has(symbol)) return false;
  if ((symbol.declarations ?? []).some(ts.isNamespaceImport)) {
    const route = context.checker.getPropertyOfType(
      context.checker.getTypeAtLocation(current),
      "Route",
    );
    return resolveAliasedSymbol(context.checker, route) === context.routeFactorySymbol;
  }

  const binding = constInitializer(context, current);
  if (binding === undefined) return false;
  visiting.add(symbol);
  const found = isRouteNamespaceOwner(context, binding.initializer, visiting);
  visiting.delete(symbol);
  return found;
};

const destructuredPropertySymbol = (
  context: CompilerContext,
  identifier: ts.Identifier,
):
  | {
      readonly binding: ts.Symbol;
      readonly property: ts.Symbol;
      readonly receiver: ts.Expression;
    }
  | undefined => {
  const binding = context.checker.getSymbolAtLocation(identifier);
  if (binding === undefined) return undefined;
  for (const declaration of binding.declarations ?? []) {
    if (!ts.isBindingElement(declaration) || !ts.isObjectBindingPattern(declaration.parent)) {
      continue;
    }
    const variable = declaration.parent.parent;
    if (
      !ts.isVariableDeclaration(variable) ||
      variable.initializer === undefined ||
      !ts.isVariableDeclarationList(variable.parent) ||
      (variable.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }

    const propertyName = declaration.propertyName ?? declaration.name;
    let name: string | undefined;
    if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) {
      name = propertyName.text;
    } else if (ts.isComputedPropertyName(propertyName)) {
      const type = context.checker.getTypeAtLocation(propertyName.expression);
      if (type.isStringLiteral()) name = type.value;
    }
    if (name === undefined) continue;

    const property = context.checker.getPropertyOfType(
      context.checker.getTypeAtLocation(variable.initializer),
      name,
    );
    const resolved = resolveAliasedSymbol(context.checker, property);
    if (resolved !== undefined) {
      return { binding, property: resolved, receiver: variable.initializer };
    }
  }
  return undefined;
};

const isRouteOwner = (
  context: CompilerContext,
  expression: ts.Expression,
  visiting: Set<ts.Symbol> = new Set(),
): boolean => {
  const current = unwrapExpression(expression);
  const symbol = symbolAtExpression(context, current);
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    return (
      symbol === context.routeFactorySymbol && isRouteNamespaceOwner(context, current.expression)
    );
  }
  if (!ts.isIdentifier(current)) return false;
  if (symbol === context.routeFactorySymbol) return true;

  const destructured = destructuredPropertySymbol(context, current);
  if (destructured !== undefined) {
    return (
      !visiting.has(destructured.binding) &&
      destructured.property === context.routeFactorySymbol &&
      isRouteNamespaceOwner(context, destructured.receiver)
    );
  }

  const binding = constInitializer(context, current);
  if (binding === undefined || visiting.has(binding.symbol)) return false;
  visiting.add(binding.symbol);
  const found = isRouteOwner(context, binding.initializer, visiting);
  visiting.delete(binding.symbol);
  return found;
};

const routeFactoryKind = (
  context: CompilerContext,
  call: ts.CallExpression,
): "make" | "index" | undefined => {
  const member = callMember(context, call);
  if (member === undefined || !isRouteOwner(context, member.receiver)) return undefined;
  return member.name === "make" || member.name === "index" ? member.name : undefined;
};

const resolveRouteCallChain = (
  context: CompilerContext,
  expression: ts.Expression,
  visiting: Set<ts.Symbol> = new Set(),
): RouteCallChain | undefined => {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    const binding = constInitializer(context, current);
    if (binding === undefined || visiting.has(binding.symbol)) return undefined;
    visiting.add(binding.symbol);
    const resolved = resolveRouteCallChain(context, binding.initializer, visiting);
    visiting.delete(binding.symbol);
    return resolved;
  }
  if (!ts.isCallExpression(current)) return undefined;

  const kind = routeFactoryKind(context, current);
  if (kind !== undefined) {
    return { call: current, terminal: current, kind, methods: [] };
  }
  const member = callMember(context, current);
  if (member?.name === undefined) return undefined;
  const receiver = resolveRouteCallChain(context, member.receiver, visiting);
  return receiver === undefined
    ? undefined
    : { ...receiver, terminal: current, methods: [...receiver.methods, current] };
};

const isRouteBuilderExpression = (context: CompilerContext, expression: ts.Expression): boolean => {
  const type = context.checker.getTypeAtLocation(expression);
  return (
    (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0 &&
    context.checker.isTypeAssignableTo(type, context.routeBuilderType)
  );
};

const hasUnsafeAnyFlow = (
  context: CompilerContext,
  expression: ts.Expression,
  visiting: Set<ts.Symbol> = new Set(),
): boolean => {
  const type = context.checker.getTypeAtLocation(expression);
  if ((type.flags & ts.TypeFlags.Any) !== 0) return true;

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return hasUnsafeAnyFlow(context, expression.expression, visiting);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    const castType = context.checker.getTypeAtLocation(expression);
    return (
      (castType.flags & ts.TypeFlags.Any) !== 0 ||
      hasUnsafeAnyFlow(context, expression.expression, visiting)
    );
  }
  if (ts.isIdentifier(expression)) {
    const binding = context.checker.getSymbolAtLocation(expression);
    if (binding === undefined || visiting.has(binding)) return false;
    visiting.add(binding);
    let unsafe = false;
    for (const declaration of binding.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration)) {
        if (
          declaration.type !== undefined &&
          (context.checker.getTypeAtLocation(declaration.name).flags & ts.TypeFlags.Any) !== 0
        ) {
          unsafe = true;
          break;
        }
        if (
          declaration.initializer !== undefined &&
          hasUnsafeAnyFlow(context, declaration.initializer, visiting)
        ) {
          unsafe = true;
          break;
        }
      }
    }
    visiting.delete(binding);
    return unsafe;
  }
  if (ts.isCallExpression(expression)) {
    const member = callMember(context, expression);
    return member !== undefined && hasUnsafeAnyFlow(context, member.receiver, visiting);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return hasUnsafeAnyFlow(context, expression.expression, visiting);
  }
  if (ts.isElementAccessExpression(expression)) {
    return (
      hasUnsafeAnyFlow(context, expression.expression, visiting) ||
      (expression.argumentExpression !== undefined &&
        (context.checker.getTypeAtLocation(expression.argumentExpression).flags &
          ts.TypeFlags.Any) !==
          0)
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      hasUnsafeAnyFlow(context, expression.whenTrue, visiting) ||
      hasUnsafeAnyFlow(context, expression.whenFalse, visiting)
    );
  }
  return false;
};

type AssignedExpressions = ReadonlyMap<ts.Symbol, ReadonlyArray<ts.Expression>>;

const collectAssignedExpressions = (context: CompilerContext): AssignedExpressions => {
  const assigned = new Map<ts.Symbol, Array<ts.Expression>>();
  const add = (identifier: ts.Identifier, expression: ts.Expression): void => {
    const symbol = context.checker.getSymbolAtLocation(identifier);
    if (symbol === undefined) return;
    const expressions = assigned.get(symbol);
    if (expressions === undefined) {
      assigned.set(symbol, [expression]);
    } else {
      expressions.push(expression);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      add(node.name, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrapExpression(node.left);
      if (ts.isIdentifier(left)) add(left, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return assigned;
};

const hasRouteFactoryOrigin = (
  context: CompilerContext,
  expression: ts.Expression,
  assigned: AssignedExpressions,
  visiting: Set<ts.Symbol> = new Set(),
): boolean => {
  const visit = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node) && routeFactoryKind(context, node) !== undefined) {
      return true;
    }
    if (ts.isIdentifier(node)) {
      const symbol = context.checker.getSymbolAtLocation(node);
      const expressions = symbol === undefined ? undefined : assigned.get(symbol);
      if (symbol !== undefined && expressions !== undefined && !visiting.has(symbol)) {
        visiting.add(symbol);
        const found = expressions.some((candidate) =>
          hasRouteFactoryOrigin(context, candidate, assigned, visiting),
        );
        visiting.delete(symbol);
        if (found) return true;
      }
    }

    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && visit(child)) found = true;
    });
    return found;
  };
  return visit(unwrapExpression(expression));
};

const isRouteChainPrefix = (left: RouteCallChain, right: RouteCallChain): boolean =>
  left.call === right.call &&
  left.methods.length < right.methods.length &&
  left.methods.every((method, index) => method === right.methods[index]);

const collectRouteCalls = Effect.fn("RouteCodegen.collectRouteCalls")(function* (
  context: CompilerContext,
) {
  const assigned = collectAssignedExpressions(context);
  const chains: Array<RouteCallChain> = [];
  const unresolvedSchemaCalls: Array<ts.CallExpression> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const member = callMember(context, node);
      const chain = resolveRouteCallChain(context, node);
      const schemaMethod = member?.name === "params" || member?.name === "query";
      const associated =
        member !== undefined &&
        (isRouteBuilderExpression(context, member.receiver) ||
          hasRouteFactoryOrigin(context, member.receiver, assigned));
      const unsafeAny =
        member !== undefined &&
        (hasUnsafeAnyFlow(context, member.receiver) || hasUnsafeAnyFlow(context, node.expression));
      const unresolvedComputed = member?.computed === true && member.name === undefined;

      if (chain !== undefined && !(schemaMethod && unsafeAny)) {
        chains.push(chain);
      } else if (associated && (schemaMethod || unresolvedComputed)) {
        unresolvedSchemaCalls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);

  const unresolved = unresolvedSchemaCalls[0];
  if (unresolved !== undefined) {
    const name = methodName(context, unresolved);
    return yield* parseError(
      name === undefined
        ? "Route codegen cannot resolve the immutable builder method selected by dynamic computed access"
        : `Route codegen cannot resolve the immutable builder used by .${name}()`,
      {
        sourcePath: context.sourcePath,
        expression: unresolved.getText(context.sourceFile),
      },
    );
  }

  const terminals = chains.filter(
    (candidate) => !chains.some((other) => isRouteChainPrefix(candidate, other)),
  );
  const records = terminals.map(
    (chain): RouteCallRecord => ({
      call: chain.call,
      terminal: chain.terminal,
      kind: chain.kind,
      methods: chain.methods,
    }),
  );
  records.sort(
    (left, right) =>
      left.call.getStart(context.sourceFile) - right.call.getStart(context.sourceFile) ||
      left.terminal.getStart(context.sourceFile) - right.terminal.getStart(context.sourceFile),
  );
  const byTerminal = new Map(records.map((record) => [record.terminal, record]));
  return { records, byTerminal };
});

/** @internal */
export const normalizeImportTypeSpecifier = (
  specifier: string,
  sourcePath: string,
  declarationPath: string,
): string => {
  if (specifier.startsWith(".")) {
    const absolute = nodePath.resolve(nodePath.dirname(sourcePath), specifier);
    const relative = nodePath
      .relative(nodePath.dirname(declarationPath), absolute)
      .replaceAll(nodePath.sep, "/");
    return relative.startsWith(".") ? relative : `./${relative}`;
  }

  const normalized = specifier.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) return specifier;

  const segments = normalized.slice(markerIndex + marker.length).split("/");
  const first = segments[0];
  if (first === undefined || first.length === 0) return specifier;

  const packageSegmentCount = first.startsWith("@") ? 2 : 1;
  const packageSegments = segments.slice(0, packageSegmentCount);
  if (packageSegments.length !== packageSegmentCount) return specifier;

  const packageName = packageSegments.join("/");
  const packagePath = segments.slice(packageSegmentCount);
  const publicPath = packagePath[0] === "dist" ? packagePath.slice(1) : packagePath;
  return publicPath.length === 0 ? packageName : `${packageName}/${publicPath.join("/")}`;
};

const rebaseImportTypes = (
  typeNode: ts.TypeNode,
  sourcePath: string,
  declarationPath: string,
  sourceFile: ts.SourceFile,
): string => {
  const transformer: ts.TransformerFactory<ts.TypeNode> = (transformationContext) => {
    const visit = (node: ts.Node): ts.VisitResult<ts.Node> => {
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        const specifier = normalizeImportTypeSpecifier(
          node.argument.literal.text,
          sourcePath,
          declarationPath,
        );
        const argument = ts.factory.createLiteralTypeNode(
          ts.factory.createStringLiteral(specifier),
        );
        return ts.factory.updateImportTypeNode(
          node,
          argument,
          node.attributes,
          node.qualifier,
          node.typeArguments,
          node.isTypeOf,
        );
      }
      return ts.visitEachChild(node, visit, transformationContext);
    };
    return (rootNode) => ts.visitNode(rootNode, visit, ts.isTypeNode) ?? rootNode;
  };

  const transformed = ts.transform(typeNode, [transformer]);
  const rebased = transformed.transformed[0];
  const output = ts
    .createPrinter()
    .printNode(ts.EmitHint.Unspecified, rebased ?? typeNode, sourceFile);
  transformed.dispose();
  return output;
};

const containsUnsafeType = (typeNode: ts.TypeNode): boolean => {
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) {
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(typeNode);
  return unsafe;
};

const pathParamNames = (routePath: string): ReadonlyArray<string> =>
  routePath
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => {
      const name = segment.slice(1);
      return name.endsWith("*") || name.endsWith("+") ? name.slice(0, -1) : name;
    });

interface RenderedSchemaTypes {
  readonly decoded: string;
  readonly input: string;
}

const sameFields = (
  expectedFields: ReadonlyArray<string>,
  properties: ReadonlyArray<ts.Symbol>,
): boolean => {
  const expected = expectedFields.slice().sort();
  const actual = properties.map((property) => property.getName()).sort();
  return (
    expected.length === actual.length && expected.every((name, index) => name === actual[index])
  );
};

const renderSchemaTypes = Effect.fn("RouteCodegen.renderSchemaTypes")(function* (
  context: CompilerContext,
  schemaExpression: ts.Expression,
  routePath: string,
  kind: "params" | "query",
) {
  const rendered = yield* Effect.try({
    try: () => {
      const schemaType = context.checker.getTypeAtLocation(schemaExpression);
      if ((schemaType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
        return Result.fail("expression resolves to any or unknown instead of a Schema");
      }
      if (!context.checker.isTypeAssignableTo(schemaType, context.routeSchemaType)) {
        return Result.fail(
          "expression is not compatible with the installed Schema.Struct contract",
        );
      }

      const outputSymbol = context.checker.getPropertyOfType(schemaType, "Type");
      const inputSymbol = context.checker.getPropertyOfType(schemaType, "Encoded");
      if (outputSymbol === undefined || inputSymbol === undefined) {
        return Result.fail("installed Schema Type or Encoded members could not be resolved");
      }
      const outputType = context.checker.getTypeOfSymbolAtLocation(outputSymbol, schemaExpression);
      const inputType = context.checker.getTypeOfSymbolAtLocation(inputSymbol, schemaExpression);
      if (
        (outputType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 ||
        (inputType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
      ) {
        return Result.fail("Schema Type or Encoded resolved to any or unknown");
      }

      const outputNode = context.checker.typeToTypeNode(
        outputType,
        schemaExpression,
        ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.AllowNodeModulesRelativePaths,
      );
      const inputNode = context.checker.typeToTypeNode(
        inputType,
        schemaExpression,
        ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.AllowNodeModulesRelativePaths,
      );
      if (
        outputNode === undefined ||
        inputNode === undefined ||
        containsUnsafeType(outputNode) ||
        containsUnsafeType(inputNode)
      ) {
        return Result.fail("Schema output could not be represented without any or unknown");
      }

      const outputProperties = context.checker.getPropertiesOfType(outputType);
      const inputProperties = context.checker.getPropertiesOfType(inputType);
      if (
        (outputType.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0 ||
        (inputType.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) === 0
      ) {
        return Result.fail(`${kind} Schema Type and Encoded must both be objects`);
      }
      if (kind === "params") {
        const expected = pathParamNames(routePath);
        if (!sameFields(expected, outputProperties) || !sameFields(expected, inputProperties)) {
          return Result.fail(
            `params Schema Type and Encoded fields must match path fields (${expected.join(", ")})`,
          );
        }
        for (const property of outputProperties) {
          if ((property.flags & ts.SymbolFlags.Optional) !== 0) {
            return Result.fail(`path field ${property.getName()} cannot be optional`);
          }
        }
        for (const property of inputProperties) {
          if ((property.flags & ts.SymbolFlags.Optional) !== 0) {
            return Result.fail(`encoded path field ${property.getName()} cannot be optional`);
          }
          const propertyType = context.checker.getTypeOfSymbolAtLocation(
            property,
            schemaExpression,
          );
          if (
            (propertyType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 ||
            !context.checker.isTypeAssignableTo(propertyType, context.pathParamInputType)
          ) {
            return Result.fail(
              `encoded path field ${property.getName()} must be a string accepted by URL interpolation`,
            );
          }
        }
      } else {
        for (const property of inputProperties) {
          const propertyType = context.checker.getTypeOfSymbolAtLocation(
            property,
            schemaExpression,
          );
          const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
          const expectedInputType = optional
            ? context.queryParamInputType
            : context.pathParamInputType;
          if (
            (propertyType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 ||
            !context.checker.isTypeAssignableTo(propertyType, expectedInputType)
          ) {
            return Result.fail(
              optional
                ? `optional encoded query field ${property.getName()} must be a string or undefined accepted by URLSearchParams`
                : `encoded query field ${property.getName()} must be a string accepted by URLSearchParams`,
            );
          }
        }
      }

      return Result.succeed({
        decoded: rebaseImportTypes(
          outputNode,
          context.sourcePath,
          context.declarationPath,
          context.sourceFile,
        ),
        input: rebaseImportTypes(
          inputNode,
          context.sourcePath,
          context.declarationPath,
          context.sourceFile,
        ),
      });
    },
    catch: (cause) =>
      parseError(`Failed to resolve the ${kind} Schema for route ${routePath}`, {
        sourcePath: context.sourcePath,
        routePath,
        cause,
      }),
  });

  if (Result.isFailure(rendered)) {
    return yield* parseError(
      `Unsupported ${kind} Schema for route ${routePath}: ${rendered.failure}`,
      {
        sourcePath: context.sourcePath,
        routePath,
        schema: schemaExpression.getText(context.sourceFile),
      },
    );
  }
  return rendered.success satisfies RenderedSchemaTypes;
});

const oneMethod = (
  context: CompilerContext,
  record: RouteCallRecord,
  name: "params" | "query",
): Effect.Effect<ts.CallExpression | undefined, PluginParseError> => {
  const calls = record.methods.filter((call) => methodName(context, call) === name);
  if (calls.length > 1) {
    return Effect.fail(
      parseError(`Route codegen does not support repeated .${name}() calls`, {
        position: record.call.pos,
      }),
    );
  }
  return Effect.succeed(calls[0]);
};

const parseRouteCall = Effect.fn("RouteCodegen.parseRouteCall")(function* (
  context: CompilerContext,
  record: RouteCallRecord,
  children: ReadonlyArray<ParsedRoute>,
) {
  let path = "";
  if (record.kind === "make") {
    const pathExpression = record.call.arguments[0];
    if (
      pathExpression === undefined ||
      (!ts.isStringLiteral(pathExpression) && !ts.isNoSubstitutionTemplateLiteral(pathExpression))
    ) {
      return yield* parseError("Route.make path must be a string literal for route codegen", {
        sourcePath: context.sourcePath,
        position: record.call.getStart(context.sourceFile),
      });
    }
    path = pathExpression.text;
  }

  const paramsCall = yield* oneMethod(context, record, "params");
  const queryCall = yield* oneMethod(context, record, "query");
  const paramsExpression = paramsCall?.arguments[0];
  const queryExpression = queryCall?.arguments[0];
  if (paramsCall !== undefined && paramsExpression === undefined) {
    return yield* parseError(`Route ${path} has an empty .params() call`, {
      sourcePath: context.sourcePath,
    });
  }
  if (queryCall !== undefined && queryExpression === undefined) {
    return yield* parseError(`Route ${path} has an empty .query() call`, {
      sourcePath: context.sourcePath,
    });
  }

  const paramsTypes =
    paramsExpression === undefined
      ? undefined
      : yield* renderSchemaTypes(context, paramsExpression, path, "params");
  const queryTypes =
    queryExpression === undefined
      ? undefined
      : yield* renderSchemaTypes(context, queryExpression, path, "query");

  return {
    path,
    paramsType: paramsTypes?.decoded,
    paramsInputType: paramsTypes?.input,
    queryType: queryTypes?.decoded,
    queryInputType: queryTypes?.input,
    children,
    isIndex: record.kind === "index",
  } satisfies ParsedRoute;
});

const parseRoutesWithContext = Effect.fn("RouteCodegen.parseRoutesWithContext")(function* (
  context: CompilerContext,
) {
  const { records, byTerminal } = yield* collectRouteCalls(context);
  const parentByChild = new Map<RouteCallRecord, RouteCallRecord>();

  for (const parent of records) {
    const childrenCalls = parent.methods.filter((call) => methodName(context, call) === "children");
    if (childrenCalls.length > 1) {
      return yield* parseError("Route codegen does not support repeated .children() calls", {
        sourcePath: context.sourcePath,
        position: parent.call.getStart(context.sourceFile),
      });
    }
    const childrenCall = childrenCalls[0];
    if (childrenCall === undefined) {
      continue;
    }
    for (const argument of childrenCall.arguments) {
      if (ts.isSpreadElement(argument)) {
        return yield* parseError("Route codegen does not support spread children", {
          sourcePath: context.sourcePath,
          child: argument.getText(context.sourceFile),
        });
      }
      const chain = resolveRouteCallChain(context, argument);
      const child = chain === undefined ? undefined : byTerminal.get(chain.terminal);
      if (child === undefined) {
        return yield* parseError(
          "Each .children() argument must resolve to one immutable Route.make() or Route.index() builder",
          {
            sourcePath: context.sourcePath,
            child: argument.getText(context.sourceFile),
          },
        );
      }
      const existingParent = parentByChild.get(child);
      if (child === parent || existingParent !== undefined) {
        return yield* parseError("A child route builder must belong to exactly one parent", {
          sourcePath: context.sourcePath,
          child: argument.getText(context.sourceFile),
        });
      }
      parentByChild.set(child, parent);
    }
  }

  const childrenByParent = new Map<RouteCallRecord, Array<RouteCallRecord>>();
  for (const [child, parent] of parentByChild) {
    const children = childrenByParent.get(parent);
    if (children === undefined) {
      childrenByParent.set(parent, [child]);
    } else {
      children.push(child);
    }
  }

  const parseRecord: (record: RouteCallRecord) => Effect.Effect<ParsedRoute, PluginParseError> =
    Effect.fn("RouteCodegen.parseRecord")(function* (record: RouteCallRecord) {
      const childRecords = childrenByParent.get(record) ?? [];
      const children = yield* Effect.forEach(childRecords, parseRecord);
      return yield* parseRouteCall(context, record, children);
    });

  const roots = records.filter((record) => !parentByChild.has(record));
  return yield* Effect.forEach(roots, parseRecord);
});

export const parseRoutes = Effect.fn("RouteCodegen.parseRoutes")(function* (
  source: string,
  sourcePath: string,
  declarationPath: string,
) {
  const context = yield* makeCompilerContext(source, sourcePath, declarationPath);
  return yield* parseRoutesWithContext(context);
});

interface ResolvedRoute {
  readonly path: string;
  readonly paramsType: string | undefined;
  readonly paramsInputType: string | undefined;
  readonly queryType: string | undefined;
  readonly queryInputType: string | undefined;
}

const rawPathParamsType = (routePath: string): string | undefined => {
  const names = pathParamNames(routePath);
  return names.length === 0
    ? undefined
    : `{ ${names.map((name) => `readonly ${JSON.stringify(name)}: string`).join("; ")} }`;
};

const rawPathParamsInputType = (routePath: string): string | undefined => {
  const names = pathParamNames(routePath);
  return names.length === 0
    ? undefined
    : `{ ${names.map((name) => `readonly ${JSON.stringify(name)}: string | number`).join("; ")} }`;
};

const combineParamTypes = (
  parent: string | undefined,
  child: string | undefined,
): string | undefined =>
  parent === undefined ? child : child === undefined ? parent : `${parent} & ${child}`;

export const resolveRoutePaths = (
  routes: ReadonlyArray<ParsedRoute>,
  parentPath?: string,
  parentParamsType?: string,
  parentParamsInputType?: string,
): ReadonlyArray<ResolvedRoute> => {
  const resolved: Array<ResolvedRoute> = [];
  for (const route of routes) {
    const path = route.isIndex
      ? (parentPath ?? "/")
      : parentPath === undefined
        ? route.path
        : `${parentPath}${route.path}`;
    const ownParamsType = route.paramsType ?? rawPathParamsType(route.path);
    const ownParamsInputType = route.paramsInputType ?? rawPathParamsInputType(route.path);
    const paramsType = combineParamTypes(parentParamsType, ownParamsType);
    const paramsInputType = combineParamTypes(parentParamsInputType, ownParamsInputType);
    resolved.push({
      path,
      paramsType,
      paramsInputType,
      queryType: route.queryType,
      queryInputType: route.queryInputType,
    });
    resolved.push(...resolveRoutePaths(route.children, path, paramsType, paramsInputType));
  }
  return resolved;
};

const addGeneratedType = (
  generated: Map<string, string>,
  path: string,
  type: string,
  description: string,
): PluginParseError | undefined => {
  const existing = generated.get(path);
  if (existing !== undefined && existing !== type) {
    return parseError(`Conflicting generated ${description} types for route ${path}`, {
      first: existing,
      second: type,
    });
  }
  generated.set(path, type);
  return undefined;
};

const renderMapEntries = (types: ReadonlyMap<string, string>): string =>
  [...types].map(([path, type]) => `    readonly ${JSON.stringify(path)}: ${type}`).join("\n");

const renderRouteDeclarations = (
  routes: ReadonlyArray<ParsedRoute>,
): Effect.Effect<string, PluginParseError> => {
  const routeTypes = new Map<string, string>();
  const routeInputTypes = new Map<string, string>();
  const routeQueryTypes = new Map<string, string>();
  const routeQueryInputTypes = new Map<string, string>();
  for (const route of resolveRoutePaths(routes)) {
    const paramsType = route.paramsType ?? "{}";
    const paramsInputType = route.paramsInputType ?? "{}";
    const errors = [
      addGeneratedType(routeTypes, route.path, paramsType, "decoded parameter"),
      addGeneratedType(routeInputTypes, route.path, paramsInputType, "URL parameter input"),
      route.queryType === undefined
        ? undefined
        : addGeneratedType(routeQueryTypes, route.path, route.queryType, "decoded query"),
      route.queryInputType === undefined
        ? undefined
        : addGeneratedType(
            routeQueryInputTypes,
            route.path,
            route.queryInputType,
            "URL query input",
          ),
    ];
    const error = errors.find((candidate) => candidate !== undefined);
    if (error !== undefined) {
      return Effect.fail(error);
    }
  }
  return Effect.succeed(`// Auto-generated by trygg
export type Routes = never

declare module "trygg/router" {
  interface RouteMap {
${renderMapEntries(routeTypes)}
  }
  interface RouteInputMap {
${renderMapEntries(routeInputTypes)}
  }
  interface RouteQueryMap {
${renderMapEntries(routeQueryTypes)}
  }
  interface RouteQueryInputMap {
${renderMapEntries(routeQueryInputTypes)}
  }
}

export {}
`);
};

const validateDeclarations = Effect.fn("RouteCodegen.validateDeclarations")(function* (
  context: CompilerContext,
  content: string,
) {
  const validationContent = content;
  const declarationPath = context.declarationPath;
  const isDeclaration = (fileName: string): boolean =>
    nodePath.resolve(fileName) === declarationPath;
  const options: ts.CompilerOptions = {
    ...context.compilerOptions,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    skipLibCheck: false,
  };
  const baseHost = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (fileName) =>
      isDeclaration(fileName) || context.host.fileExists(fileName) || baseHost.fileExists(fileName),
    readFile: (fileName) =>
      isDeclaration(fileName)
        ? validationContent
        : (context.host.readFile(fileName) ?? baseHost.readFile(fileName)),
    getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
      if (isDeclaration(fileName)) {
        return ts.createSourceFile(
          fileName,
          validationContent,
          languageVersionOrOptions,
          true,
          ts.ScriptKind.TS,
        );
      }
      return (
        context.host.getSourceFile(
          fileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile,
        ) ??
        baseHost.getSourceFile(
          fileName,
          languageVersionOrOptions,
          onError,
          shouldCreateNewSourceFile,
        )
      );
    },
  };

  const program = yield* Effect.try({
    try: () => ts.createProgram({ rootNames: [declarationPath], options, host }),
    catch: (cause) =>
      parseError("Failed to validate generated route declarations", {
        declarationPath,
        cause,
      }),
  });
  const sourceFile = program.getSourceFile(declarationPath);
  if (sourceFile === undefined) {
    return yield* parseError("TypeScript did not load generated route declarations", {
      declarationPath,
    });
  }
  const diagnostic = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ].find((candidate) => candidate.category === ts.DiagnosticCategory.Error);
  if (diagnostic !== undefined) {
    return yield* parseError(
      `Generated route declarations are unsupported: ${flattenDiagnostic(diagnostic)}`,
      { declarationPath, code: diagnostic.code },
    );
  }
});

export const generateRouteTypes = Effect.fn("RouteCodegen.generateRouteTypes")(function* (
  source: string,
  sourcePath: string,
  declarationPath: string,
) {
  const context = yield* makeCompilerContext(source, sourcePath, declarationPath);
  const routes = yield* parseRoutesWithContext(context);
  const content = yield* renderRouteDeclarations(routes);
  yield* validateDeclarations(context, content);
  return content;
});
