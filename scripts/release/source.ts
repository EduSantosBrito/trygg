import { Effect, Schema } from "effect";

export class ReleaseSourceMismatchError extends Schema.TaggedError<ReleaseSourceMismatchError>()(
  "ReleaseSourceMismatchError",
  {
    reason: Schema.Literals(["revision", "core-version"]),
    expected: Schema.String,
    actual: Schema.String,
  },
) {}

export interface ReleaseSource {
  readonly actualSha: string;
  readonly expectedSha: string;
  readonly actualTryggVersion: string;
  readonly expectedTryggVersion: string;
}

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly gitHead?: string | undefined;
}

export interface ExpectedPackageIdentity {
  readonly location: "npm" | "packed-artifact";
  readonly name: string;
  readonly version: string;
  readonly gitHead: string;
}

export class PackageIdentityMismatchError extends Schema.TaggedError<PackageIdentityMismatchError>()(
  "PackageIdentityMismatchError",
  {
    location: Schema.Literals(["npm", "packed-artifact"]),
    field: Schema.Literals(["name", "version", "gitHead"]),
    expected: Schema.String,
    actual: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

const identityMismatch = (
  expected: ExpectedPackageIdentity,
  field: "name" | "version" | "gitHead",
  actual: string | undefined,
): PackageIdentityMismatchError => {
  const label = expected.location === "npm" ? "Published package" : "Packed artifact";
  const message =
    actual === undefined
      ? `${label} ${expected.name}@${expected.version} ${field} is missing; expected ${expected[field]}`
      : `${label} ${expected.name}@${expected.version} ${field} mismatch: expected ${expected[field]}, found ${actual}`;

  return actual === undefined
    ? new PackageIdentityMismatchError({
        location: expected.location,
        field,
        expected: expected[field],
        message,
      })
    : new PackageIdentityMismatchError({
        location: expected.location,
        field,
        expected: expected[field],
        actual,
        message,
      });
};

export const validateReleaseSource = Effect.fn("validateReleaseSource")(function* (
  source: ReleaseSource,
) {
  if (source.actualSha !== source.expectedSha) {
    return yield* new ReleaseSourceMismatchError({
      reason: "revision",
      expected: source.expectedSha,
      actual: source.actualSha,
    });
  }

  if (source.actualTryggVersion !== source.expectedTryggVersion) {
    return yield* new ReleaseSourceMismatchError({
      reason: "core-version",
      expected: source.expectedTryggVersion,
      actual: source.actualTryggVersion,
    });
  }
});

export const validatePackageIdentity = Effect.fn("validatePackageIdentity")(function* (
  actual: PackageIdentity,
  expected: ExpectedPackageIdentity,
) {
  if (actual.name !== expected.name) {
    return yield* identityMismatch(expected, "name", actual.name);
  }

  if (actual.version !== expected.version) {
    return yield* identityMismatch(expected, "version", actual.version);
  }

  if (actual.gitHead !== expected.gitHead) {
    return yield* identityMismatch(expected, "gitHead", actual.gitHead);
  }
});
