/**
 * Generate tsconfig.json
 * @since 1.0.0
 */
import { Effect } from "effect"

export const generateTsConfig = (): Effect.Effect<string> =>
  Effect.succeed(`{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "trygg",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["app/**/*.ts", "app/**/*.tsx"]
}
`)
