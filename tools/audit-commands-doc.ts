/**
 * Génération de la section « commandes KAG » de `docs/LECTURE_COMPLETE.md` (#275).
 *
 * La section est **générée** depuis le registre (`tools/ignored-commands.ts`) et la
 * baseline des inconnues (`tools/audit-commands-baseline.json`) : pas de double
 * liste manuscrite. Le bloc est délimité par des marqueurs ; `npm run audit:doc`
 * le met à jour, `npm run audit:guard` vérifie qu'il est à jour.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { loadBaseline, type CommandBaseline } from "./audit-commands.js";
import { IGNORED_COMMANDS, type IgnoredCommand } from "./ignored-commands.js";

/** Fichier documentaire contenant le bloc généré. */
export const DOC_PATH = join(import.meta.dirname, "../docs/LECTURE_COMPLETE.md");

/** Marqueurs du bloc généré (ne pas modifier sans mettre à jour ce module). */
export const DOC_BEGIN_MARKER = "<!-- BEGIN AUTO: commandes-kag -->";
export const DOC_END_MARKER = "<!-- END AUTO: commandes-kag -->";

/** Échappe les `|` pour les tableaux Markdown. */
function escapeMdPipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/**
 * Rend le contenu du bloc généré (sans les marqueurs), à partir du registre et
 * de la baseline. Fonction pure : testable sans toucher au disque.
 */
export function renderGeneratedBlock(
  registry: readonly IgnoredCommand[] = IGNORED_COMMANDS,
  baseline: CommandBaseline = loadBaseline(),
): string {
  const lines: string[] = [];
  const occurrences = Object.values(baseline.commands).reduce((sum, count) => sum + count, 0);

  lines.push("### Commandes KAG : registre et classification (généré)");
  lines.push("");
  lines.push(
    "> Bloc **généré** par `npm run audit:doc` depuis `tools/ignored-commands.ts` et `tools/audit-commands-baseline.json` (#275). Ne pas l'éditer à la main : modifier le registre ou la baseline, puis régénérer.",
  );
  lines.push("");
  lines.push("| Catégorie | Définition | Mesure actuelle |");
  lines.push("|---|---|---|");
  lines.push(
    "| **Implémentée** | commande reconnue par le parser/runtime (aucun warning) | toutes les autres commandes du corpus |",
  );
  lines.push(
    `| **Ignorée volontairement** | no-op déclaré dans le registre, avec raison et issue | ${registry.length} commande(s) |`,
  );
  lines.push(
    `| **Inconnue** | ni implémentée ni déclarée no-op | ${Object.keys(baseline.commands).length} commande(s) distincte(s), ${occurrences} occurrence(s) |`,
  );
  lines.push("");

  lines.push("#### Commandes ignorées volontairement (no-op déclarés)");
  lines.push("");
  if (registry.length === 0) {
    lines.push(
      "Aucune commande n'est déclarée no-op à ce jour. Le triage des inconnues restantes est suivi par #276 : la DoD v1.0 interdit d'admettre un no-op à effet visible, audible ou de déroulement.",
    );
  } else {
    lines.push("| Commande | Effet | Raison | Issue |");
    lines.push("|---|---|---|---|");
    for (const entry of registry) {
      lines.push(
        `| \`@${escapeMdPipe(entry.name)}\` | ${escapeMdPipe(entry.effet)} | ${escapeMdPipe(entry.raison)} | ${escapeMdPipe(entry.issue)} |`,
      );
    }
  }
  lines.push("");

  lines.push("#### Commandes inconnues restantes (baseline, à trier)");
  lines.push("");
  lines.push(
    `Baseline générée le ${baseline.generatedAt} — ${baseline.source}. Issue de triage : ${baseline.triageIssue}.`,
  );
  lines.push(
    "Le nombre d'inconnues ne peut que baisser : toute commande résolue (implémentée ou déclarée no-op) doit être retirée de la baseline dans la PR correspondante (`npm run audit:baseline`).",
  );
  lines.push("");
  lines.push("| Commande | Occurrences |");
  lines.push("|---|---|");
  for (const [name, count] of Object.entries(baseline.commands)) {
    lines.push(`| \`@${escapeMdPipe(name)}\` | ${count} |`);
  }
  lines.push("");

  return lines.join("\n");
}

/** Extrait le contenu du bloc généré d'un document, ou null si les marqueurs manquent. */
export function extractGeneratedBlock(docText: string): string | null {
  const begin = docText.indexOf(DOC_BEGIN_MARKER);
  const end = docText.indexOf(DOC_END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return null;
  return docText.slice(begin + DOC_BEGIN_MARKER.length, end).replace(/^\n/, "").replace(/\n$/, "");
}

/** Relit le document et met à jour le bloc généré. */
export function writeGeneratedBlock(path: string = DOC_PATH): void {
  const block = renderGeneratedBlock();
  writeFileSync(path, replaceGeneratedBlock(readFileSync(path, "utf-8"), block), "utf-8");
}

/**
 * Remplace le bloc existant (ou l'ajoute à la fin si les marqueurs manquent).
 * Utile pour l'initialisation et l'écriture.
 */
export function replaceGeneratedBlock(docText: string, block: string): string {
  const wrapped = `${DOC_BEGIN_MARKER}\n${block}${block.endsWith("\n") ? "" : "\n"}${DOC_END_MARKER}`;
  const begin = docText.indexOf(DOC_BEGIN_MARKER);
  const end = docText.indexOf(DOC_END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    return `${docText.replace(/\s*$/, "")}\n\n${wrapped}\n`;
  }
  const before = docText.slice(0, begin);
  const after = docText.slice(end + DOC_END_MARKER.length).replace(/^\n/, "");
  return `${before}${wrapped}\n${after}`;
}

/**
 * Vérifie que le bloc du document correspond au registre/baseline actuels.
 * Retourne un message d'erreur, ou null si la doc est à jour.
 */
export function checkGeneratedBlock(
  path: string = DOC_PATH,
  registry: readonly IgnoredCommand[] = IGNORED_COMMANDS,
  baseline: CommandBaseline = loadBaseline(),
): string | null {
  const current = readFileSync(path, "utf-8");
  const block = extractGeneratedBlock(current);
  if (block === null) {
    return `Bloc généré absent de ${path} (marqueurs ${DOC_BEGIN_MARKER} / ${DOC_END_MARKER}).`;
  }
  const expected = renderGeneratedBlock(registry, baseline).replace(/\n$/, "");
  if (block.trimEnd() !== expected) {
    return `Section « commandes KAG » obsolète dans ${path} : lancer « npm run audit:doc ».`;
  }
  return null;
}

/** CLI : `--write` (défaut) met à jour la doc ; `--check` échoue si obsolète. */
function main(): void {
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const error = checkGeneratedBlock();
    if (error) {
      console.error(`[audit:doc] ${error}`);
      process.exit(1);
    }
    console.log("[audit:doc] Section générée à jour.");
    return;
  }
  writeGeneratedBlock();
  console.log(`[audit:doc] Section générée mise à jour dans ${DOC_PATH}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
