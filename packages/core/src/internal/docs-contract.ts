import { Effect, Schema } from "effect";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import * as ts from "typescript";

type DocsViolationCode =
  | "entrypoint_reachability"
  | "missing_category"
  | "missing_example"
  | "missing_module_docs"
  | "missing_remarks"
  | "missing_sidecar"
  | "missing_summary"
  | "sidecar_example"
  | "sidecar_heading"
  | "sidecar_intro"
  | "unknown_tag"
  | "visibility_tag"
  | "wrong_category";

export interface DocsViolation {
  readonly code: DocsViolationCode;
  readonly file: string;
  readonly message: string;
  readonly publicName: string;
}

export interface DocsReport {
  readonly human: string;
  readonly json: string;
  readonly reachableExports: ReadonlyArray<string>;
  readonly violations: ReadonlyArray<DocsViolation>;
}

interface DocsCategory {
  readonly name: string;
  readonly ownerModule: string;
  readonly requiresSidecar: boolean;
}

interface DocsOwner {
  readonly category: string;
  readonly entrypoint: string;
  readonly memberExports: ReadonlyArray<string>;
  readonly module: string;
  readonly namedExports: ReadonlyArray<string>;
  readonly primaryExport: string;
  readonly primaryKind: "named" | "namespace";
  readonly sidecar: string;
  readonly topic: string;
}

interface DocsConfig {
  readonly allowedTags: ReadonlyArray<string>;
  readonly categories: ReadonlyArray<DocsCategory>;
  readonly migratedOwners: ReadonlyArray<DocsOwner>;
  readonly sidecarHeadings: ReadonlyArray<string>;
}

interface PackageExports {
  readonly entrypoints: ReadonlyMap<string, string>;
}

interface ParsedDocBlock {
  readonly summary: string;
  readonly tags: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface ExportDeclarationDoc {
  readonly file: string;
  readonly kind: string;
  readonly name: string;
  readonly rawDoc: string | undefined;
}

interface OwnerCheck {
  readonly owner: DocsOwner;
  readonly reachableExports: ReadonlyArray<string>;
  readonly violations: ReadonlyArray<DocsViolation>;
}

const DocsCategorySchema = Schema.Struct({
  name: Schema.String,
  ownerModule: Schema.String,
  requiresSidecar: Schema.Boolean,
});

const DocsOwnerInputSchema = Schema.Struct({
  category: Schema.String,
  entrypoint: Schema.String,
  memberExports: Schema.optional(Schema.Array(Schema.String)),
  module: Schema.String,
  namedExports: Schema.Array(Schema.String),
  primaryExport: Schema.String,
  primaryKind: Schema.optional(
    Schema.Union([Schema.Literal("named"), Schema.Literal("namespace")]),
  ),
  sidecar: Schema.String,
  topic: Schema.String,
});

type DocsOwnerInput = typeof DocsOwnerInputSchema.Type;

const DocsConfigInputSchema = Schema.Struct({
  allowedTags: Schema.Array(Schema.String),
  categories: Schema.Array(DocsCategorySchema),
  migratedOwners: Schema.Array(DocsOwnerInputSchema),
  sidecarHeadings: Schema.Array(Schema.String),
});

const PackageJsonSchema = Schema.Struct({
  exports: Schema.Record(Schema.String, Schema.Unknown),
});

const ReportPayloadSchema = Schema.Struct({
  ok: Schema.Boolean,
  reachableExports: Schema.Array(Schema.String),
  violations: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      file: Schema.String,
      message: Schema.String,
      publicName: Schema.String,
    }),
  ),
});

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeDocsConfigInput = Schema.decodeUnknownEffect(DocsConfigInputSchema);
const decodePackageJson = Schema.decodeUnknownEffect(PackageJsonSchema);
const encodeReportPayloadJson = Schema.encodeEffect(Schema.fromJsonString(ReportPayloadSchema));

export class DocsContractConfigError extends Schema.TaggedError<DocsContractConfigError>()(
  "DocsContractConfigError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `Docs contract config error: ${this.detail}`;
  }
}

export class DocsContractFileError extends Schema.TaggedError<DocsContractFileError>()(
  "DocsContractFileError",
  { detail: Schema.String, path: Schema.String },
) {
  override get message(): string {
    return `Docs contract file error at ${this.path}: ${this.detail}`;
  }
}

type DocsContractError = DocsContractConfigError | DocsContractFileError;

export const checkDocsContract: (args: {
  readonly packageRoot: string;
  readonly touchedFiles?: ReadonlyArray<string>;
}) => Effect.Effect<DocsReport, DocsContractError> = Effect.fn("checkDocsContract")(function* ({
  packageRoot,
  touchedFiles = [],
}) {
  const config = yield* loadDocsConfig(packageRoot);
  const packageExports = yield* loadPackageExports(packageRoot);
  const ownerChecks = yield* Effect.forEach(
    config.migratedOwners,
    (owner) => checkOwner({ config, owner, packageExports, packageRoot }),
    { concurrency: 1 },
  );
  const normalizedTouchedFiles = normalizeTouchedFiles(packageRoot, touchedFiles);
  const checkAllOwners =
    normalizedTouchedFiles.size === 0 ||
    normalizedTouchedFiles.has("docs.contract.json") ||
    normalizedTouchedFiles.has("package.json");
  const touchedOwners = checkAllOwners
    ? new Set(config.migratedOwners.map((owner) => owner.module))
    : new Set(
        (yield* Effect.forEach(
          config.migratedOwners,
          (owner) =>
            isOwnerTouched({
              normalizedTouchedFiles,
              owner,
              packageExports,
              packageRoot,
            }).pipe(Effect.map((touched) => (touched ? owner.module : null))),
          { concurrency: 1 },
        )).filter((ownerModule): ownerModule is string => ownerModule !== null),
      );

  const reachableExports = [
    ...unique(ownerChecks.flatMap((check) => [...check.reachableExports])),
  ].sort();
  const violations = ownerChecks.flatMap((check) =>
    touchedOwners.has(check.owner.module) ? [...check.violations] : [],
  );
  const ok = violations.length === 0;
  const payload = {
    ok,
    reachableExports,
    violations,
  };

  const json = yield* encodeReportPayloadJson(payload).pipe(
    Effect.mapError(
      () =>
        new DocsContractConfigError({
          detail: "unable to encode report JSON",
        }),
    ),
  );

  return {
    human: formatHuman(payload),
    json,
    reachableExports,
    violations,
  };
});

const checkOwner: (args: {
  readonly config: DocsConfig;
  readonly owner: DocsOwner;
  readonly packageExports: PackageExports;
  readonly packageRoot: string;
}) => Effect.Effect<OwnerCheck, DocsContractError> = Effect.fn("checkOwner")(function* ({
  config,
  owner,
  packageExports,
  packageRoot,
}) {
  const category = findCategory(config.categories, owner.category, owner.module);
  if (category === undefined) {
    return yield* new DocsContractConfigError({
      detail: `missing category mapping for ${owner.category} -> ${owner.module}`,
    });
  }

  const ownerFile = resolve(packageRoot, owner.module);
  const ownerText = yield* readUtf8(ownerFile);
  const entrypointFile = yield* resolveEntrypointSourceFile(
    packageRoot,
    packageExports,
    owner.entrypoint,
  );
  const entrypointText = ownerFile === entrypointFile ? ownerText : yield* readUtf8(entrypointFile);

  const ownerExports = collectExportDeclarations(ownerFile, ownerText);
  const entrypointExports =
    ownerFile === entrypointFile ? [] : collectReexports(entrypointFile, entrypointText);
  const publishedBase = toPublishedBase(owner.entrypoint);

  const namedEntrypointExportsForSource = (
    sourceName: string,
  ): ReadonlyArray<{
    readonly exportName: string;
    readonly sourceName: string;
    readonly targetFile: string;
  }> =>
    entrypointExports.filter(
      (entrypointExport) =>
        entrypointExport.kind === "named" &&
        entrypointExport.sourceName === sourceName &&
        entrypointExport.targetFile === ownerFile,
    );

  const publicNamesForOwnerExport = (exportName: string): ReadonlyArray<string> => {
    const names: Array<string> = [];

    if (owner.primaryKind === "namespace" && primaryReachable) {
      names.push(`${publishedBase}.${owner.primaryExport}.${exportName}`);
    }

    if (owner.memberExports.includes(exportName) && primaryReachable) {
      names.push(`${publishedBase}.${owner.primaryExport}.${exportName}`);
    }

    if (ownerFile === entrypointFile) {
      if (owner.primaryKind === "named") {
        names.push(`${publishedBase}.${exportName}`);
      }
      return [...unique(names)];
    }

    for (const entrypointExport of namedEntrypointExportsForSource(exportName)) {
      names.push(`${publishedBase}.${entrypointExport.exportName}`);
    }

    return [...unique(names)];
  };

  const primaryPublicName =
    owner.primaryKind === "namespace"
      ? `${publishedBase}.${owner.primaryExport}`
      : (publicNamesForOwnerExport(owner.primaryExport)[0] ??
        `${publishedBase}.${owner.primaryExport}`);

  const isNamedReachable = (exportName: string): boolean =>
    ownerFile === entrypointFile
      ? ownerExports.some((ownerExport) => ownerExport.name === exportName)
      : namedEntrypointExportsForSource(exportName).length > 0;

  const primaryReachable =
    owner.primaryKind === "named"
      ? isNamedReachable(owner.primaryExport)
      : ownerFile !== entrypointFile &&
        entrypointExports.some(
          (entrypointExport) =>
            entrypointExport.kind === "namespace" &&
            entrypointExport.exportName === owner.primaryExport &&
            entrypointExport.targetFile === ownerFile,
        );

  const reachablePublicNames = (ownerExport: ExportDeclarationDoc): ReadonlyArray<string> =>
    publicNamesForOwnerExport(ownerExport.name);

  const enforcedPublicNamesForOwnerExport = (
    ownerExport: ExportDeclarationDoc,
  ): ReadonlyArray<string> => reachablePublicNames(ownerExport);

  const reachableExports = ownerExports.flatMap((ownerExport) => [
    ...enforcedPublicNamesForOwnerExport(ownerExport),
  ]);

  const violations: Array<DocsViolation> = [];

  if (!primaryReachable) {
    violations.push({
      code: "entrypoint_reachability",
      file: owner.module,
      message:
        owner.primaryKind === "namespace"
          ? `Expected ${owner.primaryExport} namespace re-export from ${owner.entrypoint}`
          : `Expected named re-export ${owner.primaryExport} from ${owner.entrypoint}`,
      publicName: primaryPublicName,
    });
  }

  for (const namedExport of owner.namedExports) {
    const namedReachable = isNamedReachable(namedExport);
    if (!namedReachable) {
      violations.push({
        code: "entrypoint_reachability",
        file: owner.module,
        message: `Expected named re-export ${namedExport} from ${owner.entrypoint}`,
        publicName: `${publishedBase}.${namedExport}`,
      });
    }
  }

  const moduleDoc = parseDocBlock(extractLeadingFileDoc(ownerText));
  if (
    moduleDoc === undefined ||
    moduleDoc.summary.length === 0 ||
    !hasTagContent(moduleDoc, "remarks")
  ) {
    violations.push({
      code: "missing_module_docs",
      file: owner.module,
      message: `Expected module summary and @remarks for ${owner.topic}`,
      publicName: primaryPublicName,
    });
  }
  if (moduleDoc !== undefined) {
    for (const tag of collectUnknownTags(moduleDoc, config.allowedTags)) {
      violations.push({
        code: "unknown_tag",
        file: owner.module,
        message: `Unknown module tag @${tag}`,
        publicName: primaryPublicName,
      });
    }
  }

  if (category.requiresSidecar) {
    const sidecarFile = resolve(packageRoot, owner.sidecar);
    if (!existsSync(sidecarFile)) {
      violations.push({
        code: "missing_sidecar",
        file: owner.sidecar,
        message: `Missing sidecar guide for ${owner.topic}`,
        publicName: primaryPublicName,
      });
    } else {
      const sidecarText = yield* readUtf8(sidecarFile);
      violations.push(
        ...validateSidecar(owner, sidecarText, config.sidecarHeadings, primaryPublicName),
      );
    }
  }

  for (const ownerExport of ownerExports) {
    const publicNames = enforcedPublicNamesForOwnerExport(ownerExport);
    if (publicNames.length === 0) {
      continue;
    }
    const publicName = publicNames[0] ?? primaryPublicName;
    const doc = parseDocBlock(ownerExport.rawDoc);

    if (doc === undefined || doc.summary.length === 0) {
      violations.push({
        code: "missing_summary",
        file: owner.module,
        message: `Missing summary for ${ownerExport.name}`,
        publicName,
      });
      continue;
    }

    const visibilityCount = countTags(doc, ["public", "internal"]);
    if (visibilityCount !== 1) {
      violations.push({
        code: "visibility_tag",
        file: owner.module,
        message: `Expected exactly one visibility tag on ${ownerExport.name}`,
        publicName,
      });
    }

    if (!hasTagContent(doc, "remarks")) {
      violations.push({
        code: "missing_remarks",
        file: owner.module,
        message: `Missing @remarks for ${ownerExport.name}`,
        publicName,
      });
    }

    const isPublic = doc.tags.has("public");
    if (isPublic) {
      const categoryTag = firstTagValue(doc, "category");
      if (categoryTag === undefined) {
        violations.push({
          code: "missing_category",
          file: owner.module,
          message: `Missing @category for ${ownerExport.name}`,
          publicName,
        });
      } else if (categoryTag !== owner.category) {
        violations.push({
          code: "wrong_category",
          file: owner.module,
          message: `Expected @category ${owner.category} on ${ownerExport.name}`,
          publicName,
        });
      }

      if (!hasTagContent(doc, "example")) {
        violations.push({
          code: "missing_example",
          file: owner.module,
          message: `Missing @example for ${ownerExport.name}`,
          publicName,
        });
      }
    }

    for (const tag of collectUnknownTags(doc, config.allowedTags)) {
      violations.push({
        code: "unknown_tag",
        file: owner.module,
        message: `Unknown tag @${tag} on ${ownerExport.name}`,
        publicName,
      });
    }
  }

  return {
    owner,
    reachableExports,
    violations,
  };
});

const isOwnerTouched: (args: {
  readonly normalizedTouchedFiles: ReadonlySet<string>;
  readonly owner: DocsOwner;
  readonly packageExports: PackageExports;
  readonly packageRoot: string;
}) => Effect.Effect<boolean, DocsContractError> = Effect.fn("isOwnerTouched")(function* ({
  normalizedTouchedFiles,
  owner,
  packageExports,
  packageRoot,
}) {
  const entrypointFile = yield* resolveEntrypointSourceFile(
    packageRoot,
    packageExports,
    owner.entrypoint,
  );

  return [owner.module, owner.sidecar, normalizeTouchedFile(packageRoot, entrypointFile)].some(
    (filePath) => normalizedTouchedFiles.has(filePath),
  );
});

const loadDocsConfig = (packageRoot: string): Effect.Effect<DocsConfig, DocsContractError> =>
  readJsonFile(resolve(packageRoot, "docs.contract.json")).pipe(Effect.flatMap(parseDocsConfig));

const loadPackageExports = (
  packageRoot: string,
): Effect.Effect<PackageExports, DocsContractError> =>
  readJsonFile(resolve(packageRoot, "package.json")).pipe(Effect.flatMap(parsePackageExports));

const readJsonFile = (path: string): Effect.Effect<unknown, DocsContractError> =>
  readUtf8(path).pipe(
    Effect.flatMap((text) =>
      decodeJson(text).pipe(
        Effect.mapError(
          () =>
            new DocsContractFileError({
              detail: "invalid JSON",
              path,
            }),
        ),
      ),
    ),
  );

const readUtf8 = (path: string): Effect.Effect<string, DocsContractError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: () =>
      new DocsContractFileError({
        detail: "unable to read file",
        path,
      }),
  });

const normalizeOwner = (owner: DocsOwnerInput): DocsOwner => ({
  category: owner.category,
  entrypoint: owner.entrypoint,
  memberExports: owner.memberExports ?? [],
  module: owner.module,
  namedExports: owner.namedExports,
  primaryExport: owner.primaryExport,
  primaryKind: owner.primaryKind ?? "namespace",
  sidecar: owner.sidecar,
  topic: owner.topic,
});

const parseDocsConfig: (value: unknown) => Effect.Effect<DocsConfig, DocsContractError> = Effect.fn(
  "parseDocsConfig",
)(function* (value: unknown) {
  const config = yield* decodeDocsConfigInput(value).pipe(
    Effect.mapError(
      () =>
        new DocsContractConfigError({
          detail: "invalid docs.contract.json",
        }),
    ),
  );

  return {
    allowedTags: config.allowedTags,
    categories: config.categories,
    migratedOwners: config.migratedOwners.map(normalizeOwner),
    sidecarHeadings: config.sidecarHeadings,
  };
});

const parsePackageExports: (value: unknown) => Effect.Effect<PackageExports, DocsContractError> =
  Effect.fn("parsePackageExports")(function* (value: unknown) {
    const packageJson = yield* decodePackageJson(value).pipe(
      Effect.mapError(
        () =>
          new DocsContractConfigError({
            detail: "invalid package.json exports",
          }),
      ),
    );

    const entrypoints = new Map<string, string>();
    for (const [exportKey, exportValue] of Object.entries(packageJson.exports)) {
      if (typeof exportValue === "string") {
        entrypoints.set(exportKey, exportValue);
        continue;
      }
      if (!isRecord(exportValue)) {
        return yield* new DocsContractConfigError({
          detail: `export ${exportKey} must be a string or object`,
        });
      }
      const typesValue = exportValue["types"];
      if (typeof typesValue !== "string") {
        return yield* new DocsContractConfigError({
          detail: `export ${exportKey} missing types path`,
        });
      }
      entrypoints.set(exportKey, typesValue);
    }

    return { entrypoints };
  });

const resolveEntrypointSourceFile: (
  packageRoot: string,
  packageExports: PackageExports,
  entrypoint: string,
) => Effect.Effect<string, DocsContractError> = Effect.fn("resolveEntrypointSourceFile")(function* (
  packageRoot: string,
  packageExports: PackageExports,
  entrypoint: string,
) {
  const typesPath = packageExports.entrypoints.get(entrypoint);
  if (typesPath === undefined) {
    return yield* new DocsContractConfigError({
      detail: `missing package export ${entrypoint}`,
    });
  }

  const relativeDistPath = stripLeadingDotSlash(typesPath)
    .replace(/^dist\//, "")
    .replace(/\.d\.ts$/, "");
  const candidates = [
    resolve(packageRoot, "src", `${relativeDistPath}.ts`),
    resolve(packageRoot, "src", `${relativeDistPath}.tsx`),
    resolve(packageRoot, "src", relativeDistPath, "index.ts"),
    resolve(packageRoot, "src", relativeDistPath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return yield* new DocsContractConfigError({
    detail: `unable to resolve source entrypoint for ${entrypoint} from ${typesPath}`,
  });
});

const collectReexports = (
  filePath: string,
  text: string,
): ReadonlyArray<{
  readonly exportName: string;
  readonly kind: "named" | "namespace";
  readonly sourceName: string;
  readonly targetFile: string;
}> => {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exports: Array<{
    readonly exportName: string;
    readonly kind: "named" | "namespace";
    readonly sourceName: string;
    readonly targetFile: string;
  }> = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
      continue;
    }

    const moduleSpecifier = readModuleSpecifier(statement.moduleSpecifier);
    if (moduleSpecifier === undefined) {
      continue;
    }

    const targetFile = resolveModuleFile(filePath, moduleSpecifier);
    if (targetFile === undefined) {
      continue;
    }

    const exportClause = statement.exportClause;
    if (exportClause !== undefined && ts.isNamespaceExport(exportClause)) {
      exports.push({
        exportName: exportClause.name.text,
        kind: "namespace",
        sourceName: exportClause.name.text,
        targetFile,
      });
      continue;
    }

    if (exportClause !== undefined && ts.isNamedExports(exportClause)) {
      for (const element of exportClause.elements) {
        exports.push({
          exportName: element.name.text,
          kind: "named",
          sourceName: element.propertyName?.text ?? element.name.text,
          targetFile,
        });
      }
    }
  }

  return exports;
};

const collectExportDeclarations = (
  filePath: string,
  text: string,
): ReadonlyArray<ExportDeclarationDoc> => {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exports = new Map<string, ExportDeclarationDoc>();

  const pushExport = (doc: ExportDeclarationDoc): void => {
    const existing = exports.get(doc.name);
    if (existing === undefined || (existing.rawDoc === undefined && doc.rawDoc !== undefined)) {
      exports.set(doc.name, doc);
    }
  };

  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) {
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      pushExport(makeExportDoc(filePath, text, statement.name.text, "class", statement));
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      pushExport(makeExportDoc(filePath, text, statement.name.text, "function", statement));
      continue;
    }
    if (ts.isInterfaceDeclaration(statement)) {
      pushExport(makeExportDoc(filePath, text, statement.name.text, "interface", statement));
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      pushExport(makeExportDoc(filePath, text, statement.name.text, "type", statement));
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          pushExport(makeExportDoc(filePath, text, declaration.name.text, "variable", statement));
        }
      }
    }
  }

  return [...exports.values()];
};

const makeExportDoc = (
  file: string,
  text: string,
  name: string,
  kind: string,
  node: ts.Node,
): ExportDeclarationDoc => ({
  file,
  kind,
  name,
  rawDoc: extractLeadingJsDoc(text, node),
});

const hasExportModifier = (node: ts.Statement): boolean => {
  if (
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableStatement(node)
  ) {
    return (
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
    );
  }

  return false;
};

const extractLeadingJsDoc = (text: string, node: ts.Node): string | undefined => {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    if (range === undefined) {
      continue;
    }
    const comment = text.slice(range.pos, range.end);
    if (comment.startsWith("/**")) {
      return comment;
    }
  }
  return undefined;
};

const extractLeadingFileDoc = (text: string): string | undefined => {
  const match = text.match(/^\s*(\/\*\*[\s\S]*?\*\/)/);
  return match?.[1];
};

const parseDocBlock = (rawDoc: string | undefined): ParsedDocBlock | undefined => {
  if (rawDoc === undefined) {
    return undefined;
  }

  const lines = rawDoc
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""));

  const summaryLines: Array<string> = [];
  const tags = new Map<string, Array<string>>();
  let currentTag: string | undefined;

  for (const line of lines) {
    const tagMatch = line.match(/^@([A-Za-z][A-Za-z0-9-]*)(?:\s+(.*))?$/);
    if (tagMatch !== null) {
      const tagName = tagMatch[1];
      if (tagName === undefined) {
        continue;
      }
      const tagValue = tagMatch[2] ?? "";
      const currentValues = tags.get(tagName) ?? [];
      currentValues.push(tagValue.trim());
      tags.set(tagName, currentValues);
      currentTag = tagName;
      continue;
    }

    if (currentTag === undefined) {
      summaryLines.push(line);
      continue;
    }

    const currentValues = tags.get(currentTag);
    if (currentValues !== undefined && currentValues.length > 0) {
      const lastValue = currentValues[currentValues.length - 1];
      currentValues[currentValues.length - 1] = [lastValue, line.trim()]
        .filter(Boolean)
        .join("\n")
        .trim();
    }
  }

  return {
    summary: summaryLines.join("\n").trim(),
    tags,
  };
};

const validateSidecar = (
  owner: DocsOwner,
  text: string,
  requiredHeadings: ReadonlyArray<string>,
  primaryPublicName: string,
): ReadonlyArray<DocsViolation> => {
  const violations: Array<DocsViolation> = [];
  const lines = text.split("\n");
  const title = lines
    .find((line) => line.startsWith("# "))
    ?.slice(2)
    .trim();
  const headings = new Set(
    lines.filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim()),
  );

  if (title !== owner.topic) {
    violations.push({
      code: "sidecar_heading",
      file: owner.sidecar,
      message: `Expected sidecar title # ${owner.topic}`,
      publicName: primaryPublicName,
    });
  }

  for (const heading of requiredHeadings) {
    if (!headings.has(heading)) {
      violations.push({
        code: "sidecar_heading",
        file: owner.sidecar,
        message: `Missing sidecar heading ## ${heading}`,
        publicName: primaryPublicName,
      });
    }
  }

  // A sidecar must lead with a benefit before mechanics: a non-empty intro
  // paragraph and a fenced code example, both above the first `##` section.
  const titleIndex = lines.findIndex((line) => line.startsWith("# "));
  const firstHeadingIndex = lines.findIndex((line) => line.startsWith("## "));
  const leadEnd = firstHeadingIndex === -1 ? lines.length : firstHeadingIndex;
  const leadLines = titleIndex === -1 ? [] : lines.slice(titleIndex + 1, leadEnd);

  let inFence = false;
  let hasIntroParagraph = false;
  let hasExample = false;
  for (const line of leadLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        hasExample = true;
      }
      inFence = !inFence;
      continue;
    }
    if (!inFence && trimmed.length > 0 && !trimmed.startsWith("#")) {
      hasIntroParagraph = true;
    }
  }

  if (!hasIntroParagraph) {
    violations.push({
      code: "sidecar_intro",
      file: owner.sidecar,
      message: `Expected a benefit lead paragraph before the first ## in ${owner.topic}`,
      publicName: primaryPublicName,
    });
  }

  if (!hasExample) {
    violations.push({
      code: "sidecar_example",
      file: owner.sidecar,
      message: `Expected a fenced code example before the first ## in ${owner.topic}`,
      publicName: primaryPublicName,
    });
  }

  return violations;
};

const collectUnknownTags = (
  doc: ParsedDocBlock,
  allowedTags: ReadonlyArray<string>,
): ReadonlyArray<string> => [...doc.tags.keys()].filter((tag) => !allowedTags.includes(tag));

const firstTagValue = (doc: ParsedDocBlock, tagName: string): string | undefined =>
  doc.tags.get(tagName)?.[0];

const hasTagContent = (doc: ParsedDocBlock, tagName: string): boolean => {
  const values = doc.tags.get(tagName);
  return values !== undefined && values.some((value) => value.trim().length > 0);
};

const countTags = (doc: ParsedDocBlock, tagNames: ReadonlyArray<string>): number =>
  tagNames.filter((tagName) => doc.tags.has(tagName)).length;

const findCategory = (
  categories: ReadonlyArray<DocsCategory>,
  name: string,
  ownerModule: string,
): DocsCategory | undefined =>
  categories.find((category) => category.name === name && category.ownerModule === ownerModule);

const toPublishedBase = (entrypoint: string): string =>
  entrypoint === "." ? "trygg" : `trygg/${entrypoint.replace(/^\.\//, "")}`;

const readModuleSpecifier = (moduleSpecifier: ts.Expression): string | undefined =>
  ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;

const resolveModuleFile = (fromFile: string, moduleSpecifier: string): string | undefined => {
  const withoutExtension = stripJsExtension(moduleSpecifier);
  const baseFile = resolve(dirname(fromFile), withoutExtension);
  const candidates = [
    `${baseFile}.ts`,
    `${baseFile}.tsx`,
    resolve(baseFile, "index.ts"),
    resolve(baseFile, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
};

const stripJsExtension = (moduleSpecifier: string): string => moduleSpecifier.replace(/\.js$/, "");

const stripLeadingDotSlash = (path: string): string => path.replace(/^\.\//, "");

const normalizeTouchedFiles = (
  packageRoot: string,
  touchedFiles: ReadonlyArray<string>,
): ReadonlySet<string> =>
  new Set(touchedFiles.map((filePath) => normalizeTouchedFile(packageRoot, filePath)));

const normalizeTouchedFile = (packageRoot: string, filePath: string): string => {
  if (filePath.startsWith(packageRoot)) {
    return normalizeRelativePath(relative(packageRoot, filePath));
  }

  const normalized = normalizeRelativePath(filePath);
  return normalized.startsWith("packages/core/")
    ? normalized.slice("packages/core/".length)
    : normalized;
};

const normalizeRelativePath = (filePath: string): string =>
  stripLeadingDotSlash(filePath).replaceAll("\\", "/");

const formatHuman = ({
  ok,
  reachableExports,
  violations,
}: {
  readonly ok: boolean;
  readonly reachableExports: ReadonlyArray<string>;
  readonly violations: ReadonlyArray<DocsViolation>;
}): string => {
  if (ok) {
    return `docs: ok (${reachableExports.length} reachable exports)`;
  }

  return [
    `docs: ${violations.length} violations`,
    ...violations.map((violation) => `- ${violation.publicName}: ${violation.message}`),
  ].join("\n");
};

const unique = <A>(values: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(values)];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
