/**
 * Génération de `docs/APPROXIMATIONS.md` (#296) depuis le registre des approximations
 * documentées (`tools/approximations.ts`, #295) et la baseline versionnée
 * (`tools/approximations-baseline.json`).
 *
 * Le document est **entièrement généré** : ne pas l'éditer à la main. `npm run
 * approximations:doc` le régénère, `npm run approximations:doc -- --check` vérifie qu'il est à
 * jour, et `npm run check:generated` (CI) refuse tout écart.
 *
 * Chaque approximation porte quatre éléments obligatoires, validés en CI par
 * `npm run approximations:check` : écart précis, issue v1.1 liée, test figé (marqueur
 * `approx:<id>`) et compteur versionné non croissant.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPROXIMATIONS,
  APPROXIMATIONS_BASELINE_PATH,
  APPROXIMATIONS_ISSUE,
  loadApproximationsBaseline,
  TEST_MARKER_PREFIX,
  type Approximation,
} from "./approximations.js";

/** Document généré. */
export const DOC_PATH = join(import.meta.dirname, "../docs/APPROXIMATIONS.md");

/** URL du dépôt pour les liens d'issues. */
export const ISSUE_URL_BASE = "https://github.com/TheArabicMonster/mahoyo-web/issues";

/**
 * Libellés lisibles « commande / fonctionnalité », **indexés par id** du registre.
 *
 * Cette table ne contient que de la présentation : les données de suivi (écart, issue, test,
 * compteur) viennent du registre. `labelProblems` vérifie que les deux ensembles d'ids coïncident
 * (aucun libellé manquant, aucun libellé orphelin).
 */
export const APPROXIMATION_LABELS: Readonly<Record<string, string>> = {
  "action-modules-subset": "Modules d'action (`@action`, `@move*`…)",
  "bindbg-not-persisted": "`@bindbg` (liaison de fond)",
  "clock-runtime-vars": "Horloge (`@dispclock`/`@tickclock`)",
  "fallnote-particles": "`@beginfallnote`/`@fallnoteopt`/`@endfallnote`",
  "focusline-canvas": "`@focusline*`",
  "infg-outfg-fore-page": "`@infg`/`@outfg`",
  "message-actions-non-swing": "Actions de message autres que `swing`",
  "pauseploy-font": "`@pauseploy`/`@resumeploy`",
  "playtimeline-test-variant": "`@playtimeline` variante de test (`frame=` sans `scene=`)",
  "ruby-proportional": "Ruby (`@ruby`)",
  "s-click-wait": "`@s` (attente de sélection)",
  "shake-fullscreen": "`@shake`/`@swing`",
  "staffrollsetting-bgcolor": "`@staffrollsetting bgcolor=`",
  "text-font-metrics": "Police du texte (métriques de glyphes)",
  "text-overflow-clip": "Texte trop long (découpe au lieu de pagination)",
  "xchgbgm-volume": "`@xchgbgm volume=`",
};

/** Échappe les `|` pour rester dans une cellule de tableau Markdown. */
function escapeMdPipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/** Date de génération de la baseline versionnée (`generatedAt`), si disponible. */
export function baselineGeneratedAt(root = process.cwd()): string | undefined {
  const path = join(root, APPROXIMATIONS_BASELINE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { generatedAt?: unknown };
    return typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Vérifie la cohérence entre le registre et la table de libellés.
 * Retourne la liste des problèmes (vide = OK).
 */
export function labelProblems(
  entries: readonly Approximation[] = APPROXIMATIONS,
  labels: Readonly<Record<string, string>> = APPROXIMATION_LABELS,
): string[] {
  const problems: string[] = [];
  const ids = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    const label = labels[entry.id];
    if (label === undefined || label.trim() === "") {
      problems.push(`libellé manquant pour l'approximation « ${entry.id} » (APPROXIMATION_LABELS).`);
    }
  }
  for (const id of Object.keys(labels)) {
    if (!ids.has(id)) {
      problems.push(`libellé orphelin « ${id} » : aucune approximation correspondante au registre.`);
    }
  }
  return problems;
}

/**
 * Rend le contenu complet de `docs/APPROXIMATIONS.md`.
 * Fonction pure : testable sans toucher au disque.
 */
export function renderApproximationsDoc(
  entries: readonly Approximation[] = APPROXIMATIONS,
  baseline: Record<string, number> = loadApproximationsBaseline(),
  labels: Readonly<Record<string, string>> = APPROXIMATION_LABELS,
  generatedAt: string | undefined = baselineGeneratedAt(),
): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const total = sorted.reduce((sum, entry) => sum + entry.compteur, 0);
  const lines: string[] = [];

  lines.push("# Approximations documentées du port");
  lines.push("");
  lines.push(
    "> Ce fichier est **généré** par `npm run approximations:doc` depuis le registre " +
      "`tools/approximations.ts` (#295) et la baseline `tools/approximations-baseline.json`. " +
      "Ne pas l'éditer à la main : modifier le registre, puis régénérer. " +
      "`npm run check:generated` (CI) échoue si le fichier est obsolète.",
  );
  lines.push("");
  lines.push(
    "Une **approximation** est un écart assumé au moteur d'origine, admis par la DoD v1.0 " +
      "(#274) parce qu'il est visible, testé et suivi. Le registre compte " +
      `**${sorted.length} approximations** (compteur cumulé : **${total}** déviation(s) documentée(s)).`,
  );
  lines.push("");
  lines.push(
    `Chaque entrée est rattachée à l'issue de suivi v1.1 [${APPROXIMATIONS_ISSUE}](${ISSUE_URL_BASE}/296) ` +
      "et porte quatre éléments obligatoires vérifiés en CI : écart précis, issue v1.1, test figé " +
      `(marqueur \`${TEST_MARKER_PREFIX}<id>\`) et compteur versionné non croissant.`,
  );
  lines.push("");
  if (generatedAt !== undefined) {
    lines.push(`Baseline versionnée : \`${APPROXIMATIONS_BASELINE_PATH}\` (générée le ${generatedAt}).`);
    lines.push("");
  }

  lines.push("## Registre");
  lines.push("");
  lines.push("| # | Id | Commande / fonctionnalité | Écart assumé | Issue | Test figé | Compteur |");
  lines.push("|---|---|---|---|---|---|---|");
  sorted.forEach((entry, index) => {
    const label = labels[entry.id] ?? "—";
    lines.push(
      `| ${index + 1} | \`${escapeMdPipe(entry.id)}\` | ${escapeMdPipe(label)} | ` +
        `${escapeMdPipe(entry.ecart)} | [${escapeMdPipe(entry.issue)}](${ISSUE_URL_BASE}/${entry.issue.replace("#", "")}) | ` +
        `\`${escapeMdPipe(entry.test)}\` | ${entry.compteur} |`,
    );
  });
  lines.push("");
  const orphans = sorted.filter((entry) => baseline[entry.id] === undefined);
  if (orphans.length > 0) {
    lines.push(
      `> ⚠️ Id(s) sans compteur dans la baseline : ${orphans.map((entry) => `\`${entry.id}\``).join(", ")} — lancer \`npm run approximations:baseline\`.`,
    );
    lines.push("");
  }

  lines.push("## Procédure — ajouter une approximation");
  lines.push("");
  lines.push("1. **Écart précis** : décrire le comportement du moteur d'origine et l'approximation retenue (pas « non implémenté »), en au moins 40 caractères.");
  lines.push("2. **Issue v1.1** : rattacher une issue de suivi au format `#N` (par défaut le suivi commun #296).");
  lines.push("3. **Test figé** : ajouter le marqueur `approx:<id>` dans un test unitaire qui échoue si le comportement approximé change sans mise à jour explicite.");
  lines.push("4. **Compteur** : déclarer le nombre de déviations connues ; la baseline versionnée doit être mise à jour explicitement, sans augmentation silencieuse.");
  lines.push("");
  lines.push("```bash");
  lines.push("# après modification de tools/approximations.ts");
  lines.push("npm run approximations:baseline   # met à jour tools/approximations-baseline.json");
  lines.push("npm run approximations:doc        # régénère docs/APPROXIMATIONS.md");
  lines.push("npm run approximations:check      # registre + baseline + tests figés");
  lines.push("npm run check:generated           # docs générées + registre (CI)");
  lines.push("```");
  lines.push("");
  lines.push(
    "La CI refuse : écart trop court, issue mal formée, test introuvable ou sans marqueur, " +
      "id dupliqué/invalide, compteur supérieur à la baseline, baseline incohérente avec le registre, " +
      "ou ce document obsolète.",
  );
  lines.push("");

  lines.push("## Retirer ou réduire une approximation");
  lines.push("");
  lines.push("- **Approximation résolue** (le comportement du moteur est reproduit) : retirer l'entrée du registre **et** de la baseline dans la même PR, retirer le marqueur du test figé (ou le test), puis régénérer la doc.");
  lines.push("- **Approximation réduite** (moins de déviations) : baisser le compteur et mettre la baseline à jour explicitement (`npm run approximations:baseline`).");
  lines.push("- Le compteur ne peut **jamais** augmenter sans justification explicite dans la PR.");
  lines.push("");

  lines.push("## Voir aussi");
  lines.push("");
  lines.push("- [`RELEASE_NOTES_V1.0.md`](RELEASE_NOTES_V1.0.md) — notes de version et liste des approximations à la clôture v1.0.");
  lines.push("- [`KAG_MAHOYO_SEMANTICS.md`](KAG_MAHOYO_SEMANTICS.md) — sémantique des commandes KAG et décisions documentées.");
  lines.push("- `tools/approximations.ts` (registre), `tools/approximations-baseline.json` (compteurs), `tools/approximations-guard.ts` (garde-fou CI).");
  lines.push(`- Issues : [#295](${ISSUE_URL_BASE}/295) (registre et garde-fou), [#296](${ISSUE_URL_BASE}/296) (suivi v1.1).`);
  lines.push("");

  return lines.join("\n");
}

/** Vérifie que le document correspond au registre/baseline actuels. Retourne un message d'erreur, ou null. */
export function checkApproximationsDoc(
  path: string = DOC_PATH,
  entries: readonly Approximation[] = APPROXIMATIONS,
  baseline: Record<string, number> = loadApproximationsBaseline(),
  labels: Readonly<Record<string, string>> = APPROXIMATION_LABELS,
  generatedAt: string | undefined = baselineGeneratedAt(),
): string | null {
  const problems = labelProblems(entries, labels);
  if (problems.length > 0) return problems.join(" ");

  if (!existsSync(path)) {
    return `Fichier absent : ${path} — lancer « npm run approximations:doc ».`;
  }
  const current = readFileSync(path, "utf-8");
  const expected = renderApproximationsDoc(entries, baseline, labels, generatedAt);
  if (current !== expected) {
    return `Document obsolète : ${path} — lancer « npm run approximations:doc ».`;
  }
  return null;
}

/** Écrit le document généré. */
export function writeApproximationsDoc(
  path: string = DOC_PATH,
  entries: readonly Approximation[] = APPROXIMATIONS,
  baseline: Record<string, number> = loadApproximationsBaseline(),
  labels: Readonly<Record<string, string>> = APPROXIMATION_LABELS,
  generatedAt: string | undefined = baselineGeneratedAt(),
): void {
  const problems = labelProblems(entries, labels);
  if (problems.length > 0) throw new Error(`[approximations:doc] ${problems.join(" ")}`);
  writeFileSync(path, renderApproximationsDoc(entries, baseline, labels, generatedAt), "utf-8");
}

/** CLI : écrit le document (défaut) ou vérifie avec `--check`. */
function main(): void {
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const error = checkApproximationsDoc();
    if (error) {
      console.error(`[approximations:doc] ${error}`);
      process.exit(1);
    }
    console.log("[approximations:doc] Document à jour.");
    return;
  }
  writeApproximationsDoc();
  console.log(`[approximations:doc] Document généré dans ${DOC_PATH}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
