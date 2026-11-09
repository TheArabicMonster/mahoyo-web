# Lint — ESLint 9 (flat config)

Issue #220. `npm run lint` exécute **ESLint 9** avec un `eslint.config.js` (flat config). ESLint 9 ne
accepte plus `--ext` : les extensions sont décrites par le motif `files` de la configuration.

## Commande et périmètre

```bash
npm run lint      # src/ tools/ tests/ + *.config.ts + eslint.config.js
npm run lint:fix  # idem, avec --fix
```

- **Inclus** : `src/**`, `tools/**`, `tests/**` (unitaires, intégration, e2e), `playwright.config.ts`,
  `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`.
- **Ignorés** (`ignores`) : `dist/`, `public/` (assets du jeu, jamais versionnés), `node_modules/`,
  `coverage/`, `reports/`, `test-results/`, `playwright-report/`, `.worktrees/`, `.claude/`,
  `.pipeline-work/`, `playwright/.cache/`.

## Configuration

`eslint.config.js` combine :

- **`@eslint/js` — `recommended`** : règles JavaScript de base ;
- **`typescript-eslint` — `recommended`** (sans règles *type-aware*, pour rester rapide en CI) :
  parser TypeScript et règles du langage ;
- globals **navigateur + Node** pour tous les fichiers (le code partagé `src/`,
  `tools/`, `tests/` mélange les deux environnements ; les types sont déjà vérifiés par `tsc`).

## Règles ajustées (aucune règle entièrement désactivée)

| Règle | Réglage | Justification |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | `argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern: "^_"` | Convention du dépôt : un paramètre d'API volontairement inutilisé (ex. `_signal`, `_unused`) est préfixé `_`. Les autres variables inutilisées restent des erreurs. |
| `@typescript-eslint/ban-ts-comment` | `allow-with-description` (`ts-ignore` et `ts-expect-error`) | Les rares `@ts-ignore` volontaires (stub de `Element.animate` en e2e) **doivent** être accompagnés d'une description ; `tsc` reste la source de vérité sur les types. |
| `no-irregular-whitespace` | défaut (aucun ajustement) | Les fixtures KAG contenant des espaces idéographiques U+3000 (texte japonais) ont été nettoyées en échappant `\\u3000` dans les sources. |

**Aucune règle n'est désactivée globalement** (`off`). Il n'y a **aucun `eslint-disable` global** de
fichier : une seule exception locale, justifiée en commentaire :

| Fichier | Règle | Justification |
|---|---|---|
| `tests/unit/mocks/fake-browser-history.ts` | `no-this-alias` (2 occurrences) | Getter d'objet littéral : `this` y désigne l'objet retourné (et non l'instance), l'alias `const self = this` est donc nécessaire ; un `eslint-disable-next-line` ciblé avec justification est utilisé. |

Toute nouvelle exception doit suivre le même format : règle ciblée, portée minimale, justification
en commentaire et entrée dans ce document.

## CI

`.github/workflows/ci.yml`, job `build-and-test` : l'étape **`npm run lint`** s'exécute juste après
`npm ci`, avant `check:assets`, `build` et `test:unit`. Une erreur de lint fait échouer la CI.

## Hors périmètre

Prettier (mise en forme) n'est pas exécuté par `npm run lint` ; le dépôt n'est pas formaté à la
Prettier (l'étape `prettier --check` de la CI reste optionnelle et non bloquante). `npm run format`
reste disponible pour un formatage ponctuel.
