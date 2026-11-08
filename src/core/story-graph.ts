/**
 * Graphe de scénario (`story-graph.json`).
 *
 * Dérivé de `story-chain.json` par le pipeline (`npm run chain`), il décrit
 * l'histoire comme un graphe typé : un nœud par script, une arête par suite
 * possible. Il sert au flowchart. Comme la table d'enchaînement, il contient des
 * libellés de choix du jeu : il est généré localement et jamais commité.
 */

/**
 * Nature d'un nœud.
 *
 * - `interlude` : script partagé entre plusieurs blocs du graphe d'origine (ex. `teatime.ks`),
 *   joué entre deux chapitres ; un seul nœud à plusieurs arêtes entrantes.
 * - `choice` : toutes ses sorties sont des options libellées (menu proposé au joueur).
 * - `end` : aucun successeur.
 * - `normal` : tous les autres.
 *
 * Priorité en cas de cumul : `interlude`, puis `choice`, puis `end`.
 */
export type GraphNodeKind = "normal" | "choice" | "interlude" | "end";

/**
 * Nature d'une arête.
 *
 * - `choice` : option libellée (porte `choice`, et éventuellement `condition` d'affichage).
 * - `conditional` : suite prise si `condition` est vraie.
 * - `normal` : suite inconditionnelle.
 */
export type GraphEdgeKind = "normal" | "choice" | "conditional";

export type GraphNode = {
  /** Identifiant stable : nom du script sans extension, en minuscules (`1-0`). */
  id: string;
  /** Nom du fichier du script (`1-0.ks`). */
  file: string;
  /**
   * Chapitre auquel appartient le script : `id` d'une entrée de `story-chain.json.chapters`
   * (le chapitre principal de sa page du graphe d'origine). Absent pour un interlude
   * partagé par plusieurs pages.
   */
  chapter?: string;
  /** Regroupement : titre de la page du graphe d'origine. Absent pour un interlude partagé par plusieurs pages. */
  arc?: string;
  kind: GraphNodeKind;
  /**
   * Nom (sans extension) de la première image de fond du script. Clé seulement :
   * l'image elle-même n'est jamais copiée ici.
   */
  thumb?: string;
};

export type GraphEdge = {
  /** `id` du nœud de départ. */
  from: string;
  /** `id` du nœud d'arrivée. */
  to: string;
  kind: GraphEdgeKind;
  /** Libellé de l'option (jamais commité : texte du jeu). */
  choice?: string;
  /** Expression TJS portée par la route. */
  condition?: string;
};

export type StoryGraph = {
  version: 1;
  /** `id` du premier script du jeu. */
  first: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};
