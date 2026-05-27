import { defineConfig } from "oxlint";
import { strict } from "effect-rules/configs";

export default defineConfig({
  rules: {
    "require-yield": "off",
    ...strict.rules,
  },
  jsPlugins: ["effect-rules"],
  ignorePatterns: ["**/dist/**", "**/node_modules/**", ".repos/**"],
});
