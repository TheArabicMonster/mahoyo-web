/**
 * Génère docs/PROGRESS.md à partir des milestones GitHub (via `gh`).
 *
 * Si aucune milestone n'est trouvée, le script échoue sans toucher au fichier.
 *
 * Usage : npm run progress
 */
import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { renderProgress, type Milestone } from "./progress-lib.js";

const OUTPUT_PATH = join(import.meta.dirname, "../docs/PROGRESS.md");

function fetchMilestones(): Milestone[] {
  const raw = execFileSync(
    "gh",
    ["api", "repos/{owner}/{repo}/milestones?state=all&per_page=100", "--paginate"],
    { encoding: "utf-8" },
  );
  // --paginate peut concaténer plusieurs tableaux JSON : [..][..]
  const merged = raw.trim().replace(/\]\s*\[/g, ",");
  return JSON.parse(merged || "[]") as Milestone[];
}

function main(): void {
  let milestones: Milestone[];
  try {
    milestones = fetchMilestones();
  } catch (err) {
    console.error("Erreur : impossible d'interroger GitHub via `gh api`.");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (milestones.length === 0) {
    console.error("Erreur : aucune milestone trouvée sur le dépôt. docs/PROGRESS.md n'a pas été modifié.");
    process.exit(1);
  }
  writeFileSync(OUTPUT_PATH, renderProgress(milestones, new Date()), "utf-8");
  console.log(`docs/PROGRESS.md généré (${milestones.length} milestone(s)).`);
}

main();
