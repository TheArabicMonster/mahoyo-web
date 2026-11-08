/**
 * Raccourcis clavier configurables (#177).
 *
 * Les liaisons sont des chaînes normalisées : une touche seule (`"s"`, `"F2"`,
 * `"Delete"`) ou un modificateur suivi de `+` (`"Alt+F4"`). Les lettres sont en
 * minuscules, les touches nommées gardent la casse de `KeyboardEvent.key`.
 */

export type ShortcutAction =
  | "saveMenu"
  | "loadMenu"
  | "quickSave"
  | "quickLoad"
  | "loadLatest"
  | "hideText"
  | "fullscreen"
  | "options"
  | "menu"
  | "auto"
  | "advanceRead"
  | "history"
  | "returnTitle"
  | "quit";

export type ShortcutBindings = Record<ShortcutAction, string[]>;

export type ShortcutDefinition = {
  id: ShortcutAction;
  label: string;
  defaults: string[];
};

/** Libellés et valeurs par défaut, dans l'ordre de la capture d'origine. */
export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  { id: "saveMenu", label: "Ouvrir le menu de sauvegarde", defaults: ["s", "F2"] },
  { id: "loadMenu", label: "Ouvrir le menu de chargement", defaults: ["l", "F3"] },
  { id: "quickSave", label: "Sauvegarde rapide", defaults: ["F11"] },
  { id: "quickLoad", label: "Ouvrir le menu de chargement rapide", defaults: ["o", "F9"] },
  { id: "loadLatest", label: "Charger la sauvegarde la plus récente", defaults: ["F12"] },
  { id: "hideText", label: "Masquer le texte", defaults: ["Delete", "Backspace"] },
  { id: "fullscreen", label: "Mode fenêtré / plein écran", defaults: ["F4"] },
  { id: "options", label: "Ouvrir les options", defaults: ["c"] },
  { id: "menu", label: "Ouvrir le menu", defaults: ["Escape"] },
  { id: "auto", label: "Lecture automatique", defaults: ["a", "F6"] },
  { id: "advanceRead", label: "Avancer jusqu'au dernier texte lu", defaults: ["f", "F7"] },
  { id: "history", label: "Ouvrir l'historique", defaults: ["r", "F5"] },
  { id: "returnTitle", label: "Retour à l'écran titre", defaults: ["p"] },
  { id: "quit", label: "Quitter le jeu", defaults: ["Alt+F4"] },
] as const;

export function defaultShortcuts(): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((d) => [d.id, [...d.defaults]]),
  ) as ShortcutBindings;
}

/** Normalise une touche seule, sans modificateur. */
function normalizeKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

/** Construit une liaison à partir d'un événement clavier, ou null si la touche est seule. */
export function bindingFromEvent(event: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): string | null {
  const key = normalizeKey(event.key);
  if (!key || key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  // Shift n'est conservé que pour les touches nommées : Shift+A produit « A », pas « Shift+a ».
  if (event.shiftKey && key.length > 1) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

function parts(binding: string): { mods: Set<string>; key: string } {
  const pieces = binding.split("+");
  const key = pieces.pop() ?? "";
  return { mods: new Set(pieces), key };
}

/** Vrai si l'événement correspond exactement à la liaison (modificateurs compris). */
export function matchesBinding(
  event: {
    key: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
  binding: string,
): boolean {
  const expected = parts(binding);
  if (normalizeKey(event.key) !== expected.key) return false;
  return (
    Boolean(event.ctrlKey) === expected.mods.has("Ctrl") &&
    Boolean(event.altKey) === expected.mods.has("Alt") &&
    Boolean(event.metaKey) === expected.mods.has("Meta") &&
    Boolean(event.shiftKey) === expected.mods.has("Shift")
  );
}

/** Retourne l'action dont une liaison correspond à l'événement, ou null. */
export function actionForEvent(
  event: {
    key: string;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
  bindings: Readonly<ShortcutBindings>,
): ShortcutAction | null {
  for (const definition of SHORTCUT_DEFINITIONS) {
    for (const binding of bindings[definition.id] ?? []) {
      if (binding && matchesBinding(event, binding)) return definition.id;
    }
  }
  return null;
}

/** Libellé affiché dans l'interface : « F2 », « S », « Alt+F4 ». */
export function formatBinding(binding: string): string {
  if (!binding) return "—";
  const { mods, key } = parts(binding);
  const display = key.length === 1 ? key.toUpperCase() : key === "Space" ? "Espace" : key;
  return [...mods, display].join("+");
}

/** Copie profonde (les tableaux de liaisons ne doivent pas être partagés). */
export function cloneShortcuts(bindings: Readonly<ShortcutBindings>): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((d) => [d.id, [...(bindings[d.id] ?? [])]]),
  ) as ShortcutBindings;
}

/** Fusionne un patch partiel (une ou plusieurs actions) avec des liaisons complètes. */
export function mergeShortcuts(
  base: Readonly<ShortcutBindings>,
  patch: Partial<ShortcutBindings> | undefined,
): ShortcutBindings {
  const merged = cloneShortcuts(base);
  if (!patch) return merged;
  for (const definition of SHORTCUT_DEFINITIONS) {
    const value = patch[definition.id];
    if (Array.isArray(value)) merged[definition.id] = [...value];
  }
  return merged;
}
