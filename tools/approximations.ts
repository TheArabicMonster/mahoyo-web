/**
 * Registre des **approximations documentées** du port (#295).
 *
 * Une approximation est un écart assumé au moteur d'origine. Chaque entrée doit porter **quatre
 * éléments obligatoires**, vérifiés par `validateApproximations` (et donc par la CI) :
 *
 * 1. `ecart` : description précise de l'écart (pas « non implémenté ») ;
 * 2. `issue` : issue de suivi **v1.1** liée (`#N`) — suivi commun [#296] ;
 * 3. `test` : chemin du test qui **fige** le comportement approximé ; le fichier doit contenir le
 *    marqueur `approx:<id>` (il échouera si le comportement change sans mise à jour explicite) ;
 * 4. `compteur` : nombre de déviations connues pour cette approximation, **versionné** dans
 *    `tools/approximations-baseline.json` et **non croissant** sans modification explicite
 *    (la CI échoue si le compteur courant dépasse la baseline).
 *
 * Règle de clôture DoD (#274) : une approximation n'est admise que si elle est visible, testée et
 * suivie ; le compteur global ne peut pas augmenter silencieusement.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Une approximation documentée (4 éléments obligatoires + compteur). */
export type Approximation = {
  /** Identifiant stable kebab-case, référencé par le marqueur `approx:<id>` du test. */
  id: string;
  /** Description précise de l'écart au comportement du moteur. */
  ecart: string;
  /** Issue de suivi v1.1 liée (format `#N`). */
  issue: string;
  /** Test qui fige le comportement approximé (chemin relatif à la racine du dépôt). */
  test: string;
  /** Nombre de déviations connues (baseline versionnée, non croissante). */
  compteur: number;
};

/** Préfixe du marqueur à placer dans le test figé. */
export const TEST_MARKER_PREFIX = "approx:";

/** Chemin de la baseline versionnée des compteurs. */
export const APPROXIMATIONS_BASELINE_PATH = "tools/approximations-baseline.json";

/** Issue de suivi commune (v1.1) des approximations. */
export const APPROXIMATIONS_ISSUE = "#296";

/**
 * Registre initial (#295). Toute nouvelle approximation doit passer par une PR qui ajoute
 * l'entrée, le test figé et le compteur correspondant.
 */
export const APPROXIMATIONS: readonly Approximation[] = [
  {
    id: "message-actions-non-swing",
    ecart:
      "Les actions continues de message autres que « swing » (chgfont, etc.) sont conservées dans l'état " +
      "mais non rendues : seule « swing » est approximée en animation CSS par caractère.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/renderer/secondary-commands.test.ts",
    compteur: 1,
  },
  {
    id: "xchgbgm-volume",
    ecart:
      "@xchgbgm volume= est appliqué comme volume de piste, alors que le moteur règle un volume global " +
      "BGM scriptable (le port n'a pas de volume global distinct des réglages utilisateur).",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/runtime.test.ts",
    compteur: 1,
  },
  {
    id: "playtimeline-test-variant",
    ecart:
      "@playtimeline avec frame= sans scene= (variante de test de menutest.ks) est toléré sans effet et " +
      "sans animation ; l'usage narratif (scene=) reste implémenté.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/playtimeline-variant.test.ts",
    compteur: 1,
  },
  {
    id: "staffrollsetting-bgcolor",
    ecart:
      "@staffrollsetting bgcolor= est conservé dans l'état mais jamais peint : le plugin d'origine stocke " +
      "la couleur sans jamais l'utiliser (paramètre mort).",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/runtime.test.ts",
    compteur: 1,
  },
  {
    id: "focusline-canvas",
    ecart:
      "@focusline* est rendu par un canvas de lignes radiales approximé : `page`, `absolute`, `interval` et " +
      "`time` sont ignorés, l'overlay couvre la scène et stop/clear ont le même effet net.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/plugin-effects.test.ts",
    compteur: 1,
  },
  {
    id: "shake-fullscreen",
    ecart:
      "@shake/@swing visent un calque dans le moteur ; le port applique l'oscillation à la scène entière et " +
      "ignore storage/page/actmode/force. Une seule secousse active à la fois.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/plugin-effects.test.ts",
    compteur: 1,
  },
  {
    id: "bindbg-not-persisted",
    ecart:
      "@bindbg est une liaison visuelle approximée au moment des panoramiques (bgMove) ; l'effet n'est pas " +
      "persisté dans les sauvegardes au-delà du drapeau de page.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/layers-image.test.ts",
    compteur: 1,
  },
  {
    id: "infg-outfg-fore-page",
    ecart:
      "@infg/@outfg posent le calque directement sur la page affichée (fore) sans @trans implicite et " +
      "l'animation n'est pas bloquante, contrairement au plugin d'origine.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/layers-image.test.ts",
    compteur: 1,
  },
  {
    id: "ruby-proportional",
    ecart:
      "La répartition du ruby sur un texte de base explicite est proportionnelle au nombre de caractères, " +
      "alors que le moteur la calcule sur la largeur des glyphes.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/parser.test.ts",
    compteur: 1,
  },
  {
    id: "s-click-wait",
    ecart:
      "@s attend un clic simple, alors que le moteur attend une sélection de bouton/lien (click-map) ; " +
      "aucun script narratif chargé par le player n'utilise @s.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/parser.test.ts",
    compteur: 1,
  },
  {
    id: "action-modules-subset",
    ecart:
      "Seul le module d'action réellement utilisé (LayerNormalMoveModule) est complet : les autres modules " +
      "sont approximés en translation linéaire et l'accélération `accel` n'est pas interpolée (les keyframes " +
      "du port sont linéaires) ; `needlayer` (création du calque manquant) n'est pas reproduit.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/actions-runtime.test.ts",
    compteur: 1,
  },
  {
    id: "fallnote-particles",
    ecart:
      "@beginfallnote/@fallnoteopt/@endfallnote sont approximés par des particules CSS génériques : les images " +
      "de notes, les options sx/sy/patterns/pastTime et la seconde couche du plugin ne sont pas reproduites ; " +
      "seuls l'activation, l'arrêt et le taux `rate` (vitesse des particules) sont rendus.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/renderer/actions-renderer.test.ts",
    compteur: 1,
  },
  {
    id: "pauseploy-font",
    ecart:
      "@pauseploy/@resumeploy masquent et restaurent la bulle ploy, mais la police n'est pas reproduite à " +
      "l'identique : le moteur force MS PGothic puis la police utilisateur (`deffont`/`resetfont`), le port " +
      "réinitialise le style de texte sur celui du thème.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/actions-runtime.test.ts",
    compteur: 1,
  },
  {
    id: "text-font-metrics",
    ecart:
      "La police du jeu d'origine (`defaultFace`/`userFace` du moteur, famille Mincho spécifique) n'est pas " +
      "redistribuable : le port utilise une pile Mincho/serif du système. À taille de police identique " +
      "(26 px du repère 1024×576, dérivée de config.tjs), la hauteur de glyphe (x-height/capitale) reste " +
      "différente de la capture d'origine car les métriques de la police diffèrent.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/renderer/text-fit.test.ts",
    compteur: 1,
  },
  {
    id: "text-overflow-clip",
    ecart:
      "Le texte d'une page plus longue que la zone de message est découpé (overflow hidden) au lieu " +
      "d'être paginé automatiquement comme peut le faire le moteur (auto-return/auto-pagination) ; " +
      "aucune réduction de police. La pagination reste décidée par le script ([p]/@pg) ; la mesure " +
      "exhaustive des débordements du corpus est déléguée à l'issue #319.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/renderer/stage-renderer.test.ts",
    compteur: 1,
  },
  {
    id: "trans-nowait-timing",
    ecart:
      "@trans nowait=1 : le moteur n'échange fore/back qu'à la fin du fondu ; le port applique la " +
      "permutation immédiatement (état final correct après @wt). Une commande qui lirait back pendant " +
      "la fenêtre nowait, avant le @wt, verrait donc l'ancien affichage au lieu du contenu préparé.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/runtime.test.ts",
    compteur: 1,
  },
  {
    id: "clock-runtime-vars",
    ecart:
      "L'horloge mémorise l'heure dans l'état runtime (clockHour/clockMinute, sauvegardés) et non dans les " +
      "variables moteur f.lastHour/f.lastMinute ; vérifié : aucun script narratif ne lit ces variables.",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/kag/clock-state.test.ts",
    compteur: 1,
  },
  {
    id: "sprite-clip-bbox",
    ecart:
      "Le clip d'un sprite `partbgid` est appliqué par `clip-path: inset(...)` sur la boîte non " +
      "transformée du sprite. Pour un sprite zoomé/rotationné, le clip suit la transformation au lieu " +
      "de rester dans le repère du partbg : l'intersection reste bornée au partbg, mais peut être " +
      "légèrement décalée sur les cas transformés (aucune occurrence critique mesurée).",
    issue: APPROXIMATIONS_ISSUE,
    test: "tests/unit/renderer/stage-renderer.test.ts",
    compteur: 1,
  },
];

/** Charge la baseline des compteurs (`tools/approximations-baseline.json`). */
export function loadApproximationsBaseline(root = process.cwd()): Record<string, number> {
  const path = join(root, APPROXIMATIONS_BASELINE_PATH);
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as { counters?: Record<string, number> };
  return parsed.counters ?? {};
}

/**
 * Valide le registre complet. Retourne la liste des problèmes (vide = registre valide).
 * `root` permet de vérifier l'existence des fichiers de test et la présence du marqueur.
 */
export function validateApproximations(
  entries: readonly Approximation[] = APPROXIMATIONS,
  root = process.cwd(),
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const label = entry.id.trim() === "" ? `entrée #${index}` : `« ${entry.id} »`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) {
      problems.push(`${label} : id invalide (kebab-case attendu).`);
    }
    if (seen.has(entry.id)) problems.push(`${label} : id en double.`);
    seen.add(entry.id);
    if (entry.ecart.trim().length < 40) {
      problems.push(`${label} : écart trop court (description précise requise, ≥ 40 caractères).`);
    }
    if (!/^#\d+$/.test(entry.issue)) {
      problems.push(`${label} : issue invalide « ${entry.issue} » (format #N attendu).`);
    }
    if (!entry.test.endsWith(".test.ts")) {
      problems.push(`${label} : test invalide « ${entry.test} » (fichier .test.ts attendu).`);
    } else {
      const testPath = join(root, entry.test);
      if (!existsSync(testPath)) {
        problems.push(`${label} : test figé introuvable « ${entry.test} ».`);
      } else if (!readFileSync(testPath, "utf-8").includes(`${TEST_MARKER_PREFIX}${entry.id}`)) {
        problems.push(`${label} : le test « ${entry.test} » ne contient pas le marqueur ${TEST_MARKER_PREFIX}${entry.id}.`);
      }
    }
    if (!Number.isInteger(entry.compteur) || entry.compteur < 0) {
      problems.push(`${label} : compteur invalide (entier ≥ 0 attendu).`);
    }
  }
  return problems;
}

/**
 * Compare les compteurs courants à la baseline versionnée.
 * Règles : même ensemble d'ids ; aucun compteur courant **supérieur** à la baseline (non
 * croissant). Un compteur inférieur est admis (une approximation a été réduite) mais doit être
 * répercuté dans la baseline dans la même PR (`npm run approximations:baseline`).
 */
export function compareApproximationsWithBaseline(
  entries: readonly Approximation[] = APPROXIMATIONS,
  baseline: Record<string, number> = {},
): string[] {
  const problems: string[] = [];
  const current = new Map(entries.map((entry) => [entry.id, entry.compteur]));
  for (const [id, count] of current) {
    const base = baseline[id];
    if (base === undefined) {
      problems.push(`« ${id} » : absente de la baseline (ajouter le compteur dans la PR).`);
    } else if (count > base) {
      problems.push(`« ${id} » : compteur ${count} > baseline ${base} (le compteur ne peut pas augmenter).`);
    }
  }
  for (const id of Object.keys(baseline)) {
    if (!current.has(id)) problems.push(`« ${id} » : présente dans la baseline mais absente du registre.`);
  }
  return problems;
}

/** Série déterministe de la baseline (une entrée par approximation). */
export function serializeApproximationsBaseline(
  entries: readonly Approximation[] = APPROXIMATIONS,
  generatedAt = new Date().toISOString().slice(0, 10),
): string {
  const counters: Record<string, number> = {};
  for (const entry of [...entries].sort((a, b) => a.id.localeCompare(b.id))) counters[entry.id] = entry.compteur;
  return `${JSON.stringify(
    {
      generatedAt,
      note: "Compteurs des approximations documentées (#295). Non croissants : mise à jour explicite dans la PR.",
      issue: APPROXIMATIONS_ISSUE,
      counters,
    },
    null,
    2,
  )}\n`;
}
