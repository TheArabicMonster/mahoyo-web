# Layout DOM et conventions visuelles

Ce document fige la structure DOM, les z-index et les règles de scaling pour que les modules `StageRenderer`, `UIManager` et `Player` puissent évoluer sans conflits.

## Résolution de référence

La résolution logique du jeu est **1280×720**. Toutes les coordonnées KAG (`center`, `vcenter`) sont exprimées dans cette résolution.

Le scaling vers la fenêtre réelle est géré **exclusivement** par le conteneur `#viewport` via CSS `aspect-ratio` + `transform: scale(...)`. Les modules internes travaillent en pixels logiques.

## Structure DOM

```html
<body>
  <div id="app">
    <div id="viewport">
      <!-- StageRenderer gère tout ce qui est sous #stage -->
      <div id="stage">
        <div id="stage-bg"></div>
        <div id="stage-sprites"></div>
        <div id="stage-effects"></div>
        <div id="stage-quake"></div>
      </div>

      <!-- Textbox gérée par StageRenderer -->
      <div id="textbox">
        <div id="textbox-frame"></div>
        <div id="text"></div>
        <div id="textbox-indicator"></div>
      </div>

      <!-- UI overlay géré par UIManager -->
      <div id="ui-overlay">
        <div id="ui-menu"></div>
        <div id="ui-flowchart"></div>
        <div id="ui-pause"></div>
        <div id="ui-cg"></div>
        <div id="ui-choices"></div>
        <div id="ui-toast"></div>
        <div id="ui-loading"></div>
      </div>
    </div>
  </div>
</body>
```

## Propriété des modules

| Élément | Propriétaire | Notes |
|---|---|---|
| `#viewport` | `Player` | Scaling, plein écran, taille de police de base. |
| `#stage` | `StageRenderer` | Images, sprites, transitions, effets, quake. |
| `#textbox` | `StageRenderer` | Typewriter, indicateur de clic, visibilité. |
| `#ui-overlay` | `UIManager` | Menus, flowchart, pause, galerie CG, choix, toasts, loading. |

## z-index

```
#stage-bg        : 0
#stage-sprites   : 10
#stage-effects   : 20
#textbox         : 30
#ui-overlay      : 100
#ui-toast        : 200
#ui-loading      : 300
```

## Capture des entrées

- Seul `#ui-overlay` et `#textbox` ont `pointer-events: auto`.
- `#stage` est en `pointer-events: none`.
- Les clics de lecture (avancer, hurry) sont captés par `#textbox` ou un panneau invisible de l'UI, puis traduits en `PlayerCommands.advance()`.
- Le clic droit (masquer l'UI) est capté par l'UI et traduit en `PlayerCommands.toggleUserHide()`.

## Classes CSS par module

Pour éviter les conflits, chaque module utilise son propre préfixe :

- `StageRenderer` : `.mh-stage-*`
- `UIManager` : `.mh-ui-*`
- `Player` : `.mh-player-*`

## Scaling

Le `#viewport` doit toujours garder un ratio 16:9. S'il ne rentre pas dans la fenêtre, il est scale down depuis le centre. Le texte et les UI overlays utilisent des unités `rem` relatives à la taille de police de base du viewport.

## Assets manquants

Un asset manquant ne doit jamais planter le renderer. Afficher un fond de couleur unie (`#000`) pour un BG manquant, et ignorer silencieusement un sprite manquant.
