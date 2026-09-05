import { Config, Effect, Schema, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { assert, describe, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as path from "node:path";
import { packCreateTryggArtifact } from "../../../../scripts/release/cli.js";
import {
  type ExpectedPackageIdentity,
  PackageIdentityMismatchError,
  ReleaseSourceMismatchError,
  validatePackageIdentity,
  validateReleaseSource,
} from "../../../../scripts/release/source.js";

const RELEASE_WORKFLOW_PATH = path.resolve(
  import.meta.dirname,
  "../../../../.github/workflows/release.yml",
);
const PUBLISH_WORKFLOW_PATH = path.resolve(
  import.meta.dirname,
  "../../../../.github/workflows/publish.yml",
);
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../../..");
const RELEASE_CLI_PATH = path.join(WORKSPACE_ROOT, "scripts/release/cli.ts");
const CLI_PACKAGE_PATH = path.join(WORKSPACE_ROOT, "packages/cli/package.json");
const CorePackage = Schema.Struct({ version: Schema.String });
const decodeCorePackage = Schema.decodeUnknownEffect(Schema.fromJsonString(CorePackage));

interface FakeNpmOptions {
  readonly expectedSha: string;
  readonly gitHead: string | "missing";
  readonly initialNotFound?: boolean;
}

const runPublishWithFakeNpm = Effect.fn("ReleaseSourceTest.runPublishWithFakeNpm")(function* (
  options: FakeNpmOptions,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-fake-npm-" });
      const bin = path.join(root, "bin");
      const fakeNpm = path.join(bin, "npm");
      const log = path.join(root, "npm.log");
      const state = path.join(root, "published");
      const githubOutput = path.join(root, "github-output");
      yield* fs.makeDirectory(bin, { recursive: true });
      yield* fs.writeFileString(
        fakeNpm,
        `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_NPM_LOG"
if [ "$1" = "view" ]; then
  if [ "$FAKE_NPM_INITIAL" = "not-found" ] && [ ! -f "$FAKE_NPM_STATE" ]; then
    printf '%s\n' 'npm ERR! code E404' >&2
    exit 1
  fi
  if [ "$FAKE_NPM_GIT_HEAD" = "missing" ]; then
    printf '{"name":"%s","version":"%s"}\n' "$FAKE_NPM_NAME" "$FAKE_NPM_VERSION"
  else
    printf '{"name":"%s","version":"%s","gitHead":"%s"}\n' "$FAKE_NPM_NAME" "$FAKE_NPM_VERSION" "$FAKE_NPM_GIT_HEAD"
  fi
  exit 0
fi
if [ "$1" = "publish" ]; then
  : > "$FAKE_NPM_STATE"
  exit 0
fi
printf 'unexpected npm command: %s\n' "$*" >&2
exit 97
`,
      );
      yield* fs.chmod(fakeNpm, 0o755);

      const corePackageText = yield* fs.readFileString(
        path.join(WORKSPACE_ROOT, "packages/core/package.json"),
      );
      const corePackage = yield* decodeCorePackage(corePackageText);
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const systemPath = yield* Config.string("PATH");
      const environment = {
        PATH: `${bin}:${systemPath}`,
        FAKE_NPM_LOG: log,
        FAKE_NPM_STATE: state,
        FAKE_NPM_NAME: "trygg",
        FAKE_NPM_VERSION: corePackage.version,
        FAKE_NPM_GIT_HEAD: options.gitHead,
        GITHUB_OUTPUT: githubOutput,
        ...(options.initialNotFound === true ? { FAKE_NPM_INITIAL: "not-found" } : {}),
      };
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "bun",
          [
            RELEASE_CLI_PATH,
            "publish-package",
            "--package",
            "trygg",
            "--package-version",
            corePackage.version,
            "--source-sha",
            options.expectedSha,
            "--cwd",
            "packages/core",
          ],
          {
            cwd: WORKSPACE_ROOT,
            env: environment,
            extendEnv: true,
            stdout: "pipe",
            stderr: "pipe",
          },
        ),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all([
        handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
        handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        handle.exitCode,
      ]);
      const npmLog = yield* fs.readFileString(log);
      const output = (yield* fs.exists(githubOutput)) ? yield* fs.readFileString(githubOutput) : "";

      return { stdout, stderr, diagnostics: `${stdout}\n${stderr}`, exitCode, npmLog, output };
    }),
  );
});

describe("release source pinning", () => {
  it.effect(
    "should reject release A when the checked-out revision or core version moved to B",
    () =>
      Effect.gen(function* () {
        // Scope: verifies the release script's deterministic guard against cross-release synchronization.
        // Assertion: either a newer checkout or a newer core version fails with the exact mismatch reason.
        const revisionError = yield* Effect.flip(
          validateReleaseSource({
            actualSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            actualTryggVersion: "1.0.0",
            expectedTryggVersion: "1.0.0",
          }),
        );
        const versionError = yield* Effect.flip(
          validateReleaseSource({
            actualSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            actualTryggVersion: "1.1.0",
            expectedTryggVersion: "1.0.0",
          }),
        );

        assert.instanceOf(revisionError, ReleaseSourceMismatchError);
        assert.strictEqual(revisionError.reason, "revision");
        assert.instanceOf(versionError, ReleaseSourceMismatchError);
        assert.strictEqual(versionError.reason, "core-version");
      }),
  );

  it.effect("should reject every missing or mismatched packed manifest identity field", () =>
    Effect.gen(function* () {
      // Scope: covers the package.json extracted from the final tarball rather than the workspace manifest.
      // Assertion: wrong name, wrong version, missing gitHead, and wrong gitHead identify the exact field.
      const expected: ExpectedPackageIdentity = {
        location: "packed-artifact",
        name: "create-trygg",
        version: "1.2.3",
        gitHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      };
      const missingGitHead = yield* Effect.flip(
        validatePackageIdentity({ name: "create-trygg", version: "1.2.3" }, expected),
      );
      const wrongName = yield* Effect.flip(
        validatePackageIdentity(
          {
            name: "not-create-trygg",
            version: "1.2.3",
            gitHead: expected.gitHead,
          },
          expected,
        ),
      );
      const wrongVersion = yield* Effect.flip(
        validatePackageIdentity(
          {
            name: expected.name,
            version: "1.2.4",
            gitHead: expected.gitHead,
          },
          expected,
        ),
      );
      const wrongGitHead = yield* Effect.flip(
        validatePackageIdentity(
          {
            name: expected.name,
            version: expected.version,
            gitHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
          expected,
        ),
      );

      assert.instanceOf(missingGitHead, PackageIdentityMismatchError);
      assert.strictEqual(missingGitHead.location, "packed-artifact");
      assert.strictEqual(missingGitHead.field, "gitHead");
      assert.isUndefined(missingGitHead.actual);
      assert.instanceOf(wrongName, PackageIdentityMismatchError);
      assert.strictEqual(wrongName.field, "name");
      assert.instanceOf(wrongVersion, PackageIdentityMismatchError);
      assert.strictEqual(wrongVersion.field, "version");
      assert.instanceOf(wrongGitHead, PackageIdentityMismatchError);
      assert.strictEqual(wrongGitHead.field, "gitHead");
    }),
  );

  it.effect("should embed gitHead only in the staged create-trygg tarball", () =>
    Effect.gen(function* () {
      // Scope: exercises the production npm-pack seam and reads the manifest extracted from that tarball.
      // Assertion: name, version, and gitHead are exact while workspace package.json remains byte-identical.
      const fs = yield* FileSystem.FileSystem;
      const output = yield* fs.makeTempDirectoryScoped({ prefix: "trygg-packed-manifest-" });
      const before = yield* fs.readFileString(CLI_PACKAGE_PATH);
      const cliPackage = yield* decodeCorePackage(before);
      const sourceSha = "cccccccccccccccccccccccccccccccccccccccc";
      const artifact = yield* packCreateTryggArtifact(sourceSha, cliPackage.version, output);
      const after = yield* fs.readFileString(CLI_PACKAGE_PATH);

      assert.strictEqual(artifact.manifest.name, "create-trygg");
      assert.strictEqual(artifact.manifest.version, cliPackage.version);
      assert.strictEqual(artifact.manifest.gitHead, sourceSha);
      assert.isTrue(yield* fs.exists(artifact.tarball));
      assert.strictEqual(after, before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("should accept an immutable npm rerun only when gitHead matches", () =>
    Effect.gen(function* () {
      // Scope: drives publish-package through a fake npm Found response without registry access.
      // Assertion: exact metadata returns success, marks published=false, and never invokes npm publish.
      const sourceSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const result = yield* runPublishWithFakeNpm({ expectedSha: sourceSha, gitHead: sourceSha });

      assert.strictEqual(result.exitCode, 0);
      assert.include(result.output, "published=false");
      assert.include(result.stdout, '"reason":"already-exists"');
      assert.lengthOf(result.npmLog.trim().split("\n"), 1);
      assert.notInclude(result.npmLog, "publish --");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("should block an immutable npm rerun when gitHead is missing", () =>
    Effect.gen(function* () {
      // Scope: covers registries or historical versions that omit source identity on a Found response.
      // Assertion: publish-package fails with the typed identity diagnostic and does not publish.
      const result = yield* runPublishWithFakeNpm({
        expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        gitHead: "missing",
      });

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(result.diagnostics, "PackageIdentityMismatchError");
      assert.include(result.diagnostics, "gitHead is missing");
      assert.lengthOf(result.npmLog.trim().split("\n"), 1);
      assert.strictEqual(result.output, "");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("should block an immutable npm rerun when gitHead mismatches", () =>
    Effect.gen(function* () {
      // Scope: covers an occupied npm version published from a different commit.
      // Assertion: the existing canary behavior remains a hard failure with no second publish attempt.
      const result = yield* runPublishWithFakeNpm({
        expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        gitHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(result.diagnostics, "PackageIdentityMismatchError");
      assert.include(result.diagnostics, "gitHead mismatch");
      assert.lengthOf(result.npmLog.trim().split("\n"), 1);
      assert.strictEqual(result.output, "");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("should verify npm gitHead after publishing", () =>
    Effect.gen(function* () {
      // Scope: models registry absence, publication, and subsequent metadata visibility with one fake npm state file.
      // Assertion: success requires view, publish, then a matching post-publish view in that order.
      const sourceSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const result = yield* runPublishWithFakeNpm({
        expectedSha: sourceSha,
        gitHead: sourceSha,
        initialNotFound: true,
      });

      assert.strictEqual(result.exitCode, 0);
      assert.include(result.output, "published=true");
      const commands = result.npmLog.trim().split("\n");
      assert.lengthOf(commands, 3);
      assert.match(commands[0] ?? "", /^view /);
      assert.match(commands[1] ?? "", /^publish /);
      assert.match(commands[2] ?? "", /^view /);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("should fail after publish when npm reports a different gitHead", () =>
    Effect.gen(function* () {
      // Scope: covers the irreversible boundary where npm accepted bytes but returned the wrong source identity.
      // Assertion: post-publish verification blocks completion and reports published=false.
      const result = yield* runPublishWithFakeNpm({
        expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        gitHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        initialNotFound: true,
      });

      assert.notStrictEqual(result.exitCode, 0);
      assert.include(result.diagnostics, "gitHead mismatch");
      assert.include(result.output, "published=false");
      assert.lengthOf(result.npmLog.trim().split("\n"), 3);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "should pin sync and publish the same packed artifact immediately after its smoke",
    () =>
      Effect.gen(function* () {
        // Scope: verifies the workflow wiring that joins prepared source, packed smoke, and npm publication.
        // Assertion: sync uses the prepared SHA/version and publish consumes the tarball from the preceding step.
        const fs = yield* FileSystem.FileSystem;
        const workflow = yield* fs.readFileString(RELEASE_WORKFLOW_PATH);
        const syncStart = workflow.indexOf("\n  sync:\n");
        const publishJobStart = workflow.indexOf("\n  publish-create-trygg:\n");
        const syncJob = workflow.slice(syncStart, publishJobStart);

        assert.isAtLeast(syncStart, 0);
        assert.isAbove(publishJobStart, syncStart);
        assert.include(workflow, "source_sha: ${{ steps.detect.outputs.source_sha }}");
        assert.include(workflow, "ref: ${{ github.sha }}");
        assert.include(syncJob, "ref: ${{ needs.prepare.outputs.source_sha }}");
        assert.notInclude(syncJob, "ref: ${{ github.ref_name }}");
        assert.include(syncJob, '--source-sha "${{ needs.prepare.outputs.source_sha }}"');
        assert.include(syncJob, '--trygg-version "${{ needs.prepare.outputs.trygg_version }}"');
        assert.include(syncJob, '--trygg-source-sha "${{ needs.prepare.outputs.source_sha }}"');
        assert.include(
          workflow,
          'wait-for-npm --package trygg --package-version "${{ needs.prepare.outputs.trygg_version }}" --source-sha "${{ needs.prepare.outputs.source_sha }}"',
        );

        const smokeStep = workflow.indexOf("      - name: Smoke packed create-trygg artifact");
        const nextStep = workflow.indexOf("\n      - name:", smokeStep + 1);
        const publishStep = workflow.indexOf("      - name: Publish create-trygg");

        assert.isAtLeast(smokeStep, 0);
        assert.strictEqual(nextStep + 1, publishStep);
        assert.include(workflow, '--source-sha "${{ needs.sync.outputs.commit_sha }}"');
        assert.include(workflow, '--trygg-source-sha "${{ needs.prepare.outputs.source_sha }}"');
        assert.include(
          workflow,
          '--source-sha "${{ needs.sync.outputs.commit_sha }}" --cwd packages/cli',
        );
        assert.include(workflow, '--artifact "${{ steps.artifact.outputs.package_tarball }}"');
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("should route tag publication through the exact packed artifact contract", () =>
    Effect.gen(function* () {
      // Scope: protects the tag-triggered workflow from bypassing release sync and tarball smoke.
      // Assertion: no direct npm publish remains and create-trygg reuses the adjacent smoke output with both SHAs.
      const fs = yield* FileSystem.FileSystem;
      const workflow = yield* fs.readFileString(PUBLISH_WORKFLOW_PATH);
      const createJobStart = workflow.indexOf("\n  publish-create-trygg:\n");
      const createJob = workflow.slice(createJobStart);
      const smokeStep = createJob.indexOf("      - name: Smoke packed create-trygg artifact");
      const nextStep = createJob.indexOf("\n      - name:", smokeStep + 1);
      const publishStep = createJob.indexOf("      - name: Publish create-trygg");

      assert.isAtLeast(createJobStart, 0);
      assert.notInclude(workflow, "npm publish");
      assert.notInclude(workflow, "working-directory: packages/cli");
      assert.include(createJob, "Verify exact release sync");
      assert.include(createJob, "Verify published trygg identity");
      assert.include(createJob, "Scaffold and build smoke");
      assert.include(createJob, '.tryggSourceSha | select(type == "string" and length == 40)');
      assert.include(createJob, '--source-sha "${{ steps.tag.outputs.source_sha }}"');
      assert.include(createJob, '--trygg-source-sha "${{ steps.tag.outputs.trygg_source_sha }}"');
      assert.include(createJob, '--artifact "${{ steps.artifact.outputs.package_tarball }}"');
      assert.isAtLeast(smokeStep, 0);
      assert.strictEqual(nextStep + 1, publishStep);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
