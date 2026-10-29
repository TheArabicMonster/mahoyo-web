/**
 * Logique pure de génération de docs/PROGRESS.md (aucun accès réseau ni disque).
 * Utilisée par tools/progress.ts et testée avec Vitest.
 */

export interface Milestone {
  title: string;
  open_issues: number;
  closed_issues: number;
  html_url?: string;
  due_on?: string | null;
}

export const BAR_WIDTH = 20;
export const GLOBAL_MILESTONE = "v1.0";

/** Pourcentage entier closed/(open+closed). 0 si aucune issue. */
export function computePercent(open: number, closed: number): number {
  const total = open + closed;
  if (total <= 0) return 0;
  return Math.round((closed / total) * 100);
}

/** Barre de progression textuelle, ex. `[██████░░░░░░░░░░░░░░] 30 %`. */
export function renderBar(percent: number, width: number = BAR_WIDTH): string {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${p} %`;
}

/** Tri par titre (ordre naturel : v1.0 avant v1.1 avant v1.10). */
export function sortMilestones(ms: Milestone[]): Milestone[] {
  return [...ms].sort((a, b) => a.title.localeCompare(b.title, "en", { numeric: true }));
}

function stateLabel(percent: number, total: number): string {
  if (total === 0) return "⚪ Non commencé";
  if (percent === 100) return "🟢 Terminé";
  if (percent === 0) return "⚪ Non commencé";
  return "🟡 En cours";
}

/**
 * Rend le contenu complet de PROGRESS.md.
 * @param date date de génération (injectée pour rester déterministe en test)
 */
export function renderProgress(milestones: Milestone[], date: Date): string {
  const sorted = sortMilestones(milestones);
  const lines: string[] = [];
  lines.push("# Progression du projet", "");
  lines.push(
    "> Ce fichier est **généré** par `npm run progress` à partir des milestones GitHub.",
    "> Ne pas l'éditer à la main : les modifications seraient écrasées.",
    "",
  );

  const global = sorted.find((m) => m.title === GLOBAL_MILESTONE);
  if (global) {
    const total = global.open_issues + global.closed_issues;
    const pct = computePercent(global.open_issues, global.closed_issues);
    lines.push(`## Progression globale (${GLOBAL_MILESTONE})`, "", "```", renderBar(pct), "```", "");
    lines.push(`${global.closed_issues} issue(s) fermée(s) sur ${total}.`, "");
  }

  lines.push("## Détail par milestone", "");
  lines.push("| Milestone | Fermées | Ouvertes | Total | Progression | État |");
  lines.push("|---|---|---|---|---|---|");
  for (const m of sorted) {
    const total = m.open_issues + m.closed_issues;
    const pct = computePercent(m.open_issues, m.closed_issues);
    lines.push(
      `| ${m.title} | ${m.closed_issues} | ${m.open_issues} | ${total} | ${renderBar(pct, 10)} | ${stateLabel(pct, total)} |`,
    );
  }
  lines.push("");

  lines.push("## Légende", "");
  lines.push("- 🟢 Terminé : toutes les issues de la milestone sont fermées.");
  lines.push("- 🟡 En cours : travail actif.");
  lines.push("- ⚪ Non commencé : aucune issue fermée ou milestone vide.", "");
  lines.push(`_Généré le ${date.toISOString().slice(0, 10)}._`, "");
  return lines.join("\n");
}
