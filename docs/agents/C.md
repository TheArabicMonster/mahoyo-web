# Agent C — UIManager

## Objectif

Implémenter `src/ui/ui-manager.ts`, une implémentation DOM de l'interface `UIManager` définie dans `src/ui/types.ts`.

## Interface à implémenter

```ts
export interface UIManager {
  init(root: HTMLElement, commands: PlayerCommands): void;
  show(view: UIView): void;
  setStatus(status: Readonly<PlayerStatus>): void;
  showChoices(options: readonly string[]): void;
  hideChoices(): void;
  confirm(message: string): Promise<boolean>;
  toast(message: string, duration?: Ms): void;
  setInputEnabled(enabled: boolean): void;
  dispose(): void;
}
```

## Fichiers que tu possèdes

- `src/ui/ui-manager.ts`
- `tests/unit/ui/ui-manager.test.ts`
- Styles propres : `src/ui/ui-manager.css` (optionnel)

## Fichiers interdits

- `src/kag/**`
- `src/renderer/**`
- `src/ui/types.ts`
- `src/ui/player.ts`
- `src/main.ts`
- `index.html`
- CSS global (`src/main.css`)
- `package.json`, `vite.config.ts`, `tsconfig.json`

## Décisions déjà tranchées

- Layout DOM : voir `docs/layout.md`.
- L'UI est déclarative : elle affiche exactement ce que `show(view)` lui demande.
- L'UI ne connaît pas le runtime. Elle traduit les entrées en `PlayerCommands`.
- `pointer-events` : `#stage` est `none`, l'UI capte les clics.
- Préfixes CSS : `.mh-ui-*`.

## Keymap complète à implémenter

| Entrée | Commande |
|---|---|
| Clic gauche / Espace / Entrée | `commands.advance()` |
| Clic droit | `commands.toggleUserHide()` |
| Molette haut | `commands.rollback()` |
| Molette bas | `commands.advance()` |
| Ctrl | Activer temporairement le skip (relâcher = désactiver) |
| Échap | `commands.openScreen("pause")` ou `commands.closeScreen()` |
| F | `commands.toggleFullscreen()` |
| A | `commands.setMode("auto")` / `"normal"` |
| S | `commands.setMode("skip")` / `"normal"` |

## Écrans à implémenter

- `title` : menu principal avec liste des scripts.
- `game` : écran de jeu (masque les overlays).
- `pause` / `save` / `load` : menu de pause.
- `settings` : réglages audio/affichage.
- `backlog` : historique du texte.
- `flowchart` : arbre des chapitres.

## Trous connus

Si le contrat est insuffisant, choisis l'hypothèse la plus simple, documente-la dans `docs/agents/C-QUESTIONS.md`, et continue.

## Références

- Contrats : `src/ui/types.ts`, `src/kag/events.ts`
- Layout : `docs/layout.md`
- Mock de référence : `tests/unit/mocks/fake-ui-manager.ts`

## Non-objectifs

- Moteur KAG.
- Rendu visuel des sprites/backgrounds.
- Audio.
- Logique de sauvegarde (la UI affiche les slots, le Player gère la persistance).

## Definition of Done

- [ ] `npx tsc --noEmit` passe.
- [ ] `npm test` passe (au moins les tests du module).
- [ ] Tous les écrans `UIView` peuvent être affichés.
- [ ] La keymap fonctionne en jsdom (tests simulés).
- [ ] Aucune dépendance npm ajoutée sans justification.
- [ ] Aucun asset sous copyright n'est commité.
