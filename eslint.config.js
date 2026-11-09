// ESLint 9 — flat config (issue #220).
//
// Périmètre : `src/`, `tools/`, `tests/` et les fichiers de configuration à la racine. ESLint 9
// n'accepte plus `--ext` : les extensions sont décrites par `files`.
//
// Les règles désactivées ou ajustées sont documentées et justifiées dans `docs/LINT.md`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Dossiers générés, non versionnés ou hors périmètre (assets du jeu, artefacts de test).
    ignores: [
      "dist/**",
      "public/**",
      "node_modules/**",
      "coverage/**",
      "reports/**",
      "test-results/**",
      "playwright-report/**",
      ".worktrees/**",
      ".claude/**",
      ".pipeline-work/**",
      "playwright/.cache/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts", "**/*.cts", "**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Les identifiants préfixés `_` sont volontairement inutilisés (paramètres d'interface).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Les commentaires `@ts-expect-error`/`@ts-ignore` sont volontaires dans les tests et les
      // adaptateurs de types ; ils sont vérifiés par `tsc`.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description", "ts-ignore": "allow-with-description" },
      ],
    },
  },
);
