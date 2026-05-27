/**
 * JSX lowering for Trygg component requirement inference.
 *
 * @remarks
 * TypeScript intentionally gives every TSX expression the type `JSX.Element`,
 * which erases the requirement marker returned by `trygg/jsx-runtime` overloads.
 * This module lowers TSX into explicit `jsx` / `jsxs` calls so those overloads
 * remain visible to TypeScript-aware tooling. The Vite plugin applies the same
 * hidden lowering before Vite compiles modules, so user source stays authored as
 * JSX while Trygg-owned tooling can reason about requirement-carrying elements.
 *
 * @internal
 * @since 1.0.0
 */
import * as ts from "typescript";

export interface TryggJsxRequirementTransformResult {
  readonly code: string;
  readonly transformed: boolean;
}

interface RuntimeIdentifiers {
  readonly jsx: ts.Identifier;
  readonly jsxs: ts.Identifier;
  readonly Fragment: ts.Identifier;
}

const INTRINSIC_NAME = /^[a-z]|-/;

const isIntrinsicTagName = (name: string): boolean => INTRINSIC_NAME.test(name);

const jsxTagNameText = (tagName: ts.JsxTagNameExpression): string => {
  if (ts.isIdentifier(tagName) || tagName.kind === ts.SyntaxKind.ThisKeyword) {
    return tagName.getText();
  }
  if (ts.isPropertyAccessExpression(tagName)) {
    return tagName.getText();
  }
  return `${tagName.namespace.getText()}:${tagName.name.getText()}`;
};

const tagExpression = (tagName: ts.JsxTagNameExpression): ts.Expression => {
  if (ts.isJsxNamespacedName(tagName)) {
    return ts.factory.createStringLiteral(jsxTagNameText(tagName));
  }
  if (ts.isIdentifier(tagName) && isIntrinsicTagName(tagName.text)) {
    return ts.factory.createStringLiteral(tagName.text);
  }
  if (tagName.kind === ts.SyntaxKind.ThisKeyword) {
    return ts.factory.createThis();
  }
  return tagName;
};

const collectIdentifierNames = (sourceFile: ts.SourceFile): ReadonlySet<string> => {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
};

const uniqueIdentifier = (base: string, used: ReadonlySet<string>): ts.Identifier => {
  if (!used.has(base)) {
    return ts.factory.createIdentifier(base);
  }

  let index = 1;
  for (;;) {
    const candidate = `${base}${index}`;
    if (!used.has(candidate)) {
      return ts.factory.createIdentifier(candidate);
    }
    index += 1;
  }
};

const makeRuntimeImport = (ids: RuntimeIdentifiers): ts.ImportDeclaration =>
  ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports([
        ts.factory.createImportSpecifier(false, ts.factory.createIdentifier("jsx"), ids.jsx),
        ts.factory.createImportSpecifier(false, ts.factory.createIdentifier("jsxs"), ids.jsxs),
        ts.factory.createImportSpecifier(
          false,
          ts.factory.createIdentifier("Fragment"),
          ids.Fragment,
        ),
      ]),
    ),
    ts.factory.createStringLiteral("trygg/jsx-runtime"),
  );

const decodeJsxText = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").trim())
    .filter((line) => line.length > 0)
    .join(" ");

const visitExpression = (expression: ts.Expression, visitor: ts.Visitor): ts.Expression => {
  const visited = ts.visitNode(expression, visitor, ts.isExpression);
  return visited ?? expression;
};

const expressionFromJsxChild = (
  child: ts.JsxChild,
  visitor: ts.Visitor,
): ts.Expression | ts.SpreadElement | undefined => {
  if (ts.isJsxText(child)) {
    const text = decodeJsxText(child.getText());
    return text.length > 0 ? ts.factory.createStringLiteral(text) : undefined;
  }

  if (ts.isJsxExpression(child)) {
    if (child.expression === undefined) {
      return undefined;
    }
    const expression = visitExpression(child.expression, visitor);
    return child.dotDotDotToken === undefined
      ? expression
      : ts.factory.createSpreadElement(expression);
  }

  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
    return visitExpression(child, visitor);
  }
  return undefined;
};

const semanticChildren = (
  children: ts.NodeArray<ts.JsxChild>,
  visitor: ts.Visitor,
): ReadonlyArray<ts.Expression | ts.SpreadElement> => {
  const output: Array<ts.Expression | ts.SpreadElement> = [];
  for (const child of children) {
    const expression = expressionFromJsxChild(child, visitor);
    if (expression !== undefined) {
      output.push(expression);
    }
  }
  return output;
};

const jsxAttributeName = (name: ts.JsxAttributeName): string =>
  ts.isJsxNamespacedName(name) ? `${name.namespace.text}:${name.name.text}` : name.text;

const expressionFromAttributeInitializer = (
  initializer: ts.JsxAttributeValue | undefined,
  visitor: ts.Visitor,
): ts.Expression => {
  if (initializer === undefined) {
    return ts.factory.createTrue();
  }
  if (ts.isStringLiteral(initializer)) {
    return ts.factory.createStringLiteral(initializer.text);
  }
  if (ts.isJsxExpression(initializer)) {
    if (initializer.expression === undefined) {
      return ts.factory.createTrue();
    }
    return visitExpression(initializer.expression, visitor);
  }
  return visitExpression(initializer, visitor);
};

const propsFromAttributesAndChildren = (
  attributes: ts.JsxAttributes,
  children: ReadonlyArray<ts.Expression | ts.SpreadElement>,
  visitor: ts.Visitor,
): ts.Expression => {
  const properties: Array<ts.ObjectLiteralElementLike> = [];

  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      properties.push(
        ts.factory.createSpreadAssignment(visitExpression(attribute.expression, visitor)),
      );
      continue;
    }

    const name = jsxAttributeName(attribute.name);
    const propertyName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
      ? ts.factory.createIdentifier(name)
      : ts.factory.createStringLiteral(name);
    properties.push(
      ts.factory.createPropertyAssignment(
        propertyName,
        expressionFromAttributeInitializer(attribute.initializer, visitor),
      ),
    );
  }

  if (children.length === 1) {
    const onlyChild = children[0];
    if (onlyChild !== undefined) {
      properties.push(
        ts.factory.createPropertyAssignment(
          "children",
          onlyChild.kind === ts.SyntaxKind.SpreadElement
            ? ts.factory.createArrayLiteralExpression([onlyChild])
            : onlyChild,
        ),
      );
    }
  } else if (children.length > 1) {
    properties.push(
      ts.factory.createPropertyAssignment(
        "children",
        ts.factory.createArrayLiteralExpression(children, true),
      ),
    );
  }

  return properties.length === 0
    ? ts.factory.createNull()
    : ts.factory.createObjectLiteralExpression(properties, true);
};

const jsxRuntimeCall = (
  callee: ts.Identifier,
  tag: ts.Expression,
  props: ts.Expression,
): ts.CallExpression => ts.factory.createCallExpression(callee, undefined, [tag, props]);

const transformJsxElement = (
  node: ts.JsxElement,
  ids: RuntimeIdentifiers,
  visitor: ts.Visitor,
): ts.Expression => {
  const children = semanticChildren(node.children, visitor);
  const props = propsFromAttributesAndChildren(node.openingElement.attributes, children, visitor);
  const callee = children.length > 1 ? ids.jsxs : ids.jsx;
  return jsxRuntimeCall(callee, tagExpression(node.openingElement.tagName), props);
};

const transformJsxSelfClosingElement = (
  node: ts.JsxSelfClosingElement,
  ids: RuntimeIdentifiers,
  visitor: ts.Visitor,
): ts.Expression =>
  jsxRuntimeCall(
    ids.jsx,
    tagExpression(node.tagName),
    propsFromAttributesAndChildren(node.attributes, [], visitor),
  );

const transformJsxFragment = (
  node: ts.JsxFragment,
  ids: RuntimeIdentifiers,
  visitor: ts.Visitor,
): ts.Expression => {
  const children = semanticChildren(node.children, visitor);
  const props = propsFromAttributesAndChildren(
    ts.factory.createJsxAttributes([]),
    children,
    visitor,
  );
  const callee = children.length > 1 ? ids.jsxs : ids.jsx;
  return jsxRuntimeCall(callee, ids.Fragment, props);
};

/**
 * Lower TSX syntax to explicit Trygg JSX runtime calls.
 *
 * @remarks
 * The returned code is an implementation detail of Trygg tooling. It is not
 * presented to users and should not be used as an app source formatter.
 *
 * @internal
 * @since 1.0.0
 */
export const transformTryggJsxForRequirements = (
  source: string,
  fileName = "source.tsx",
): TryggJsxRequirementTransformResult => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const usedNames = collectIdentifierNames(sourceFile);
  const ids: RuntimeIdentifiers = {
    jsx: uniqueIdentifier("__tryggJsx", usedNames),
    jsxs: uniqueIdentifier("__tryggJsxs", usedNames),
    Fragment: uniqueIdentifier("__tryggFragment", usedNames),
  };
  let transformed = false;

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visitor: ts.Visitor = (node) => {
      if (ts.isJsxElement(node)) {
        transformed = true;
        return transformJsxElement(node, ids, visitor);
      }
      if (ts.isJsxSelfClosingElement(node)) {
        transformed = true;
        return transformJsxSelfClosingElement(node, ids, visitor);
      }
      if (ts.isJsxFragment(node)) {
        transformed = true;
        return transformJsxFragment(node, ids, visitor);
      }
      return ts.visitEachChild(node, visitor, context);
    };

    return (node) => {
      const visited = ts.visitEachChild(node, visitor, context);
      if (!transformed) {
        return visited;
      }
      return ts.factory.updateSourceFile(visited, [makeRuntimeImport(ids), ...visited.statements]);
    };
  };

  const result = ts.transform(sourceFile, [transformer]);
  const nextSourceFile = result.transformed[0] ?? sourceFile;
  const code = ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printFile(nextSourceFile)
    .replace(/\.tsx(["'])/g, ".ts$1");
  result.dispose();

  return { code: transformed ? code : source, transformed };
};
