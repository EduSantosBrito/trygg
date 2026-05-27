/**
 * Generate .oxlintrc.json
 * @since 1.0.0
 */
import { Effect } from "effect";

export const generateOxlintConfig: Effect.Effect<string> = Effect.succeed(`{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "rules": {
    "require-yield": "off"
  },
  "ignorePatterns": ["**/dist/**", "**/node_modules/**"]
}
`);
