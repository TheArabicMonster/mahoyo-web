/**
 * Registre unique des commandes KAG **volontairement** non implémentées (#275).
 *
 * Règle de la DoD v1.0 (voir `docs/DEFINITION_OF_DONE.md`) : un no-op n'est
 * admis que s'il n'a **aucun effet visible, audible ou de déroulement**. Toute
 * entrée à effet non nul doit donc porter une justification explicite **et** la
 * référence de l'accord/issue qui l'a admise.
 *
 * Le triage #276 est clos (clôture v1.0, #302) : le corpus de référence ne
 * contient plus aucune commande inconnue et la baseline est **figée vide** (mode
 * zéro strict). Ce registre contient les seuls no-ops admis (5) ; ne jamais y
 * ajouter une commande à effet visible sans accord explicite.
 */

/** Effet que la commande produit dans le moteur d'origine (justifie le no-op). */
export type IgnoredCommandEffect =
  | "aucun"
  | "déroulement"
  | "texte"
  | "image"
  | "audio"
  | "ui"
  | "effets";

/** Une commande volontairement ignorée (no-op documenté). */
export interface IgnoredCommand {
  /** Nom de commande sans `@`, en minuscules (ex. « tickclock »). */
  name: string;
  /** Pourquoi elle est ignorée (explication lisible). */
  raison: string;
  /** Effet produit dans le moteur d'origine. */
  effet: IgnoredCommandEffect;
  /** Issue de suivi légitimant l'état (ex. « #276 »). */
  issue: string;
  /**
   * Référence de l'accord explicite qui a admis ce no-op.
   * Obligatoire si `effet !== "aucun"` (DoD : aucun no-op à effet visible).
   */
  accord?: string;
}

/** Catégories d'effet valides. */
export const IGNORED_COMMAND_EFFECTS: readonly IgnoredCommandEffect[] = [
  "aucun",
  "déroulement",
  "texte",
  "image",
  "audio",
  "ui",
  "effets",
];

/**
 * Registre effectif.
 *
 * Les cinq entrées sont issues du triage #276 et des lots #283, #284 et #287 :
 * commandes sans aucun effet visible, audible ou de déroulement dans le port.
 * Toute autre commande inconnue reste à implémenter ou approximer et ne doit
 * pas être déclarée no-op.
 */
export const IGNORED_COMMANDS: readonly IgnoredCommand[] = [
  {
    name: "autocache",
    raison:
      "Préchargement d'images avant une attente : uniquement de la performance, aucun effet visible, audible ou de déroulement (triage #276).",
    effet: "aucun",
    issue: "#283",
  },
  {
    name: "settracerreturn",
    raison:
      "Règle la destination de retour du traceur de parcours (mode debug d'origine). Seuls usages utiles : sp2.ks, script système non chargé par le player (écrans spéciaux/archive) : aucun effet visible, audible ou de déroulement dans le port (triage #276).",
    effet: "aucun",
    issue: "#287",
  },
  {
    name: "startchart",
    raison:
      "Lance une carte de fin de chapitre TYPE-MOON (graphique de flowchart .gc) propre au moteur d'origine. Aucun écran de ce type n'est modélisé par le player et les scripts concernés (sp2.ks, first.ks) sont des scripts système non chargés par le parcours jouable : aucun effet dans le port (triage #276).",
    effet: "aucun",
    issue: "#287",
  },
  {
    name: "loadtimeline",
    raison:
      "Charge un fichier de timeline .tla : le pipeline d'assets ne convertit pas les .tla (aucun asset timeline dans le manifeste) et l'unique usage utile est menutest.ks, script de test non chargé par le player ; les timelines jouables passent par les données *tladata embarquées et @playtimeline scene=. Aucun effet dans le port (triage #276).",
    effet: "aucun",
    issue: "#287",
  },
  {
    name: "deffont",
    raison:
      "Seul usage du corpus : face=user. Le port web n'expose aucun réglage de police utilisateur et @resetfont retombe sur la police du thème : aucun effet visible (triage #276).",
    effet: "aucun",
    issue: "#284",
  },
];

/** Index nom → entrée, pour la classification de l'audit. */
export const IGNORED_COMMANDS_BY_NAME: ReadonlyMap<string, IgnoredCommand> = new Map(
  IGNORED_COMMANDS.map((entry) => [entry.name, entry]),
);

const EFFECT_SET = new Set<string>(IGNORED_COMMAND_EFFECTS);
const NAME_PATTERN = /^[a-z0-9_]+$/;
const ISSUE_PATTERN = /^#\d+$/;
/** Longueur minimale d'une raison pour qu'elle soit considérée explicite. */
export const MIN_REASON_LENGTH = 20;

/**
 * Valide le registre (ou un registre fourni, pour les tests).
 * Retourne la liste des problèmes ; vide si tout est valide.
 *
 * Règles :
 * - nom sans `@`, en minuscules, unique ;
 * - `effet` dans la liste autorisée ;
 * - `raison` explicite (≥ 20 caractères) ;
 * - `issue` au format `#123` ;
 * - si `effet !== "aucun"`, un `accord` explicite est requis (DoD v1.0).
 */
export function validateIgnoredCommands(entries: readonly IgnoredCommand[] = IGNORED_COMMANDS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const label = entry.name.trim() === "" ? `entrée #${index}` : `« ${entry.name} »`;
    if (!NAME_PATTERN.test(entry.name)) {
      problems.push(`${label} : nom invalide (minuscules, sans @, [a-z0-9_]+).`);
    }
    if (seen.has(entry.name)) {
      problems.push(`${label} : nom en double dans le registre.`);
    }
    seen.add(entry.name);
    if (!EFFECT_SET.has(entry.effet)) {
      problems.push(`${label} : effet inconnu « ${String(entry.effet)} ».`);
    }
    if (entry.raison.trim().length < MIN_REASON_LENGTH) {
      problems.push(`${label} : raison absente ou trop courte (justification explicite requise).`);
    }
    if (!ISSUE_PATTERN.test(entry.issue)) {
      problems.push(`${label} : issue invalide « ${entry.issue} » (format attendu #N).`);
    }
    if (entry.effet !== "aucun" && (entry.accord ?? "").trim() === "") {
      problems.push(
        `${label} : effet « ${entry.effet} » sans accord explicite — la DoD interdit un no-op à effet visible, audible ou de déroulement.`,
      );
    }
  }

  return problems;
}
