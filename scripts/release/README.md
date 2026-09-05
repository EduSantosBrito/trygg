# Release Automation

The release cascade ties both published packages and the CLI's generated `trygg` dependency version to verified source revisions.

`.github/workflows/release.yml` owns the version-bump cascade. `.github/workflows/publish.yml` routes tag-triggered publication through the same release CLI contracts. Publish through `bun ./scripts/release/cli.ts`; do not bypass it with a direct `npm publish`.

## Source Cascade

1. `detect-trygg-bump` records the prepared checkout's `HEAD` as `source_sha` and reads `trygg_version` from that revision.
2. Checks and the `trygg` publication run from `source_sha`. The published `trygg` identity must have that SHA as `gitHead`.
3. After `trygg` is available, `sync` runs from the same `source_sha`. It verifies the checkout, core version, and core source ancestry; updates the CLI version and tracked `trygg` version plus the website dependency; and records the core revision as `tryggSourceSha`. The workflow then refreshes the lockfile.
4. `commit-sync` commits only those release-sync paths when they changed and emits `commit_sha`; a no-change rerun reuses the current SHA. It refuses to push if the remote branch has moved beyond `source_sha`.
5. `create-trygg` is checked, packed, tagged, and published from `commit_sha`. Its own `gitHead` is `commit_sha`, while `tryggSourceSha` continues to identify the core release at `source_sha`.

The `trygg@<version>` tag targets `source_sha`. The `create-trygg@<version>` tag targets the post-sync `commit_sha`. Existing tags must already point to those exact revisions; a mismatch is a hard stop.

Any checkout, version, ancestry, or remote-branch mismatch stops the cascade rather than mixing two releases.

## Artifact Contract

Every package identity is the exact tuple `name`, `version`, and `gitHead`. `create-trygg` packing writes `gitHead` only into the staged package, then reads `package/package.json` back from the tarball and verifies all three fields.

The packed CLI has two template gates:

1. The pack file list must contain the required CLI runtime files plus both `templates/blank/` and `templates/incident/`.
2. The smoke installs that exact tarball, invokes its installed `create-trygg` binary for both templates, verifies the generated `trygg` dependency, then runs `bun run typecheck` and `bun run build` in each project.

The smoke emits `package_tarball`. The immediately following publish step requires that path, revalidates its manifest, and passes the same tarball to `npm publish`; it must not repack from the workspace.

The source-tree checks that precede the packed smoke use the repository scripts:

```sh
bun run --cwd packages/cli typecheck
bun run typecheck:templates
bun run --cwd packages/cli test
bun run --cwd packages/cli test:scaffold-smoke
```

## Dist Tags And Reruns

A prerelease uses its first prerelease identifier as the npm dist-tag. For example, `0.5.0-canary.3` publishes with `--tag canary`; a stable version passes no explicit `--tag`.

Before and after publication, the release CLI reads npm's `name`, `version`, and `gitHead`. A rerun is a safe no-op only when an existing immutable version matches all three fields. A missing or different field, a local or packed identity mismatch, or an npm lookup failure is a hard stop with no second publish attempt.
