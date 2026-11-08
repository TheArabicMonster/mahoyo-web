# Plan — configuration fidèle au jeu d'origine

Source : captures du menu `Config` de la version PC patchée en français (onglets
**Système**, **Message**, **Son/Effet**, **Raccourcis**) et noms des éléments dans
`scenario/config_system.ks` (les valeurs réelles sont pilotées par un plugin TJS absent
du dossier `scenario/`). Ce document fixe la correspondance retenue pour le port web,
les valeurs par défaut et les adaptations imposées par le navigateur.

## 1. Principe

Le port n'a aujourd'hui qu'un écran de réglages plat (`textSpeed`, `autoDelay`,
`fontScale`, `textboxOpacity`, volumes globaux). On le remplace par un modèle complet
et un écran à quatre onglets, avec persistance dans `localStorage`.

- **Source de vérité du modèle** : `src/renderer/types.ts` (`DisplaySettings`,
  `AudioSettings`) et `src/ui/types.ts` (`GameSettings`, `ShortcutSettings`).
- **Persistance** : `src/player/settings-store.ts`, avec migration des anciennes
  sauvegardes (les champs absents prennent la valeur par défaut).
- **Orchestration** : `src/ui/player.ts` applique les réglages au renderer, à l'audio
  et aux entrées.
- **UI** : `src/ui/ui-manager.ts`, quatre onglets et composants segmentés.

## 2. Correspondance des réglages

### Onglet Système

| Libellé d'origine | Clé du port | Type / défaut | Comportement |
|---|---|---|---|
| Mode plein écran : Adapter à l'écran / Afficher sur tout l'écran / Pas étendu | `display.fullscreenMode` | `fit` / `fill` / `none`, défaut `fit` | `fit` = `min(largeur, hauteur)` ; `fill` = `max` (recadrage) ; `none` = échelle 1. Appliqué au viewport et en plein écran. |
| Mode fenêtré : Fixer la taille / résolutions 1024×576 → 1920×1080 | `display.windowSize` | `fit` ou `"WxH"`, défaut `fit` | Adaptation web : plafonne la taille d'affichage à la résolution choisie, puis ajuste au navigateur. |
| Mise en scène du texte affiché : Activée / Sans | `display.textAnimation` | `fade` / `none`, défaut `fade` | Fondu d'apparition de la page de texte. |
| Mise en scène du texte déjà lu : Fondu / Sans, Durée, Opacité | `display.readFade`, `readFadeDuration`, `readFadeOpacity` | `true`, `1500` ms, `0.4` | Durée réglable (0–3000 ms), opacité 0–100 %. `Sans` = texte lu non atténué. |
| Réglage de la souris : 1 clic / 2 clics | `display.mouseMode` | `menu` / `hideThenMenu`, défaut `menu` | Clic droit : `menu` ouvre le menu ; `hideThenMenu` cache d'abord le texte puis ouvre le menu. |
| Curseur autoguidé | `display.autoHideCursor` | `false` | Masque le curseur après 2 s d'inactivité en jeu ; le réaffiche au mouvement. |

### Onglet Message

| Libellé d'origine | Clé du port | Type / défaut | Comportement |
|---|---|---|---|
| Vitesse des scènes non lues | `display.textSpeedUnread` | `36` ms/car. | Vitesse de frappe des pages non lues. |
| Afficher toute la page (non lues) | `display.instantUnreadPage` | `false` | Force la page entière immédiatement. |
| Vitesse des scènes déjà lues | `display.textSpeedRead` | `26` ms/car. | Vitesse de frappe des pages déjà lues. |
| Afficher toute la page (déjà lues) | `display.instantReadPage` | `false` | Force la page entière immédiatement. |
| Délai entre les pages en auto | `display.autoPageDelay` | `3000` ms | Attente en mode auto sur un point de fin de page. |
| Délai entre les lignes en auto | `display.autoLineDelay` | `2200` ms | Attente en mode auto sur `[l]`. |
| Clic gauche en mode auto | `display.autoClick` | `cancel` (`cancel` ou `skip`) | `cancel` arrête l'auto ; `skip` termine l'animation/avance. |
| Saut automatique des scènes déjà lues | `display.autoSkipRead` | `false` | Entre en skip automatiquement sur une page déjà lue. |
| Afficher confirmation | `display.autoSkipConfirm` | `true` | Demande confirmation avant le skip automatique. |
| Touche d'avance rapide | `display.fastForwardKey` | `shift` (`enter`/`shift`/`ctrl`) | Maintien = accélère la frappe (ou la termine). |
| Avance rapide : tous / déjà lus | `display.fastForwardScope` | `read` (`all`/`read`) | Portée de la touche d'avance rapide. |
| Changer la police | `display.fontFamily` | `""` | Pile CSS choisie (`""` = police du port). |

Réglages existants conservés : `fontScale`, `textboxOpacity`, `skipUnread` (passer aussi
le texte non lu), `language`.

### Onglet Son/Effet

| Libellé d'origine | Clé du port | Type / défaut | Comportement |
|---|---|---|---|
| Volume des musiques + Muet | `audio.bgm`, `audio.bgmMuted` | `0.7`, `false` | Gain du canal BGM. |
| Volume des bruitages + Muet + test | `audio.se`, `audio.seMuted` | `0.6`, `false` | Gain SE ; bouton de test (bip synthétique, sans asset). |
| Volume des sons système + Muet | `audio.system`, `audio.systemMuted` | `0.5`, `false` | Gain des sons d'interface. |
| Affichage final des pages : Oui / Non | `display.instantEffects` | `false` | À la fin d'une page, amène les effets en cours à leur état final (hors texte). |
| Arrêt des animations en cours : Oui / Non | `display.stopAnimations` | `true` | Un clic interrompt (ou non) les animations en cours. Le port garde `true` par défaut pour que l'ouverture reste sautable, même si la capture montre `Non`. |
| Effacement du texte au changement de page : Oui / Non | `display.clearTextOnPageChange` | `true` | Un `clearText` de changement de page vide le texte, ou le conserve. |
| Affichage des effets spéciaux : Oui / Non | `display.specialEffects` | `true` | Active `noise`, `haze`, tremblements et effets visuels. |

`audio.master`, `audio.voice` et `audio.muted` restent dans le modèle (compatibilité),
mais l'écran suit les trois canaux de l'original.

### Onglet Raccourcis

| Action | Défaut |
|---|---|
| Menu de sauvegarde | `S`, `F2` |
| Menu de chargement | `L`, `F3` |
| Sauvegarde rapide | `F11` |
| Menu de chargement rapide | `O`, `F9` |
| Charger la sauvegarde la plus récente | `F12` |
| Masquer le texte | `Delete`, `Backspace` |
| Fenêtré / plein écran | `F4` |
| Ouvrir les options | `C` |
| Ouvrir le menu | `Esc` |
| Lecture automatique | `A`, `F6` |
| Avancer jusqu'au dernier texte lu | `F`, `F7` |
| Ouvrir l'historique | `R`, `F5` |
| Retour à l'écran titre | `P` |
| Quitter le jeu | `Alt+F4` |

Les touches Espace/Entrée (avancer), flèche gauche (recul) et Échap (fermer) restent
des conventions fixes. Chaque action accepte deux combinaisons ; l'interface permet de
les changer par capture clavier et de tout réinitialiser.

## 3. Adaptations web assumées

- **Taille de fenêtre / résolution** : un navigateur ne peut pas redimensionner la
  fenêtre du système. Les préréglages plafonnent la taille d'affichage du viewport.
- **Plein écran** : passe par l'API Fullscreen du navigateur ; les trois modes règlent
  l'échelle interne (`fit`, `fill`, `1:1`).
- **Quitter le jeu** : `window.close()` ; si le navigateur le refuse (onglet non ouvert
  par un script), retour au titre avec un message.
- **Curseur autoguidé** : interprété comme masquage automatique du curseur après
  inactivité (le sens exact du plugin TJS n'est pas établi).
- **Sons système** : le port n'a pas encore de sons de menu ; le volume est appliqué
  dès qu'un son d'interface sera émis, et le bouton de test utilise un bip synthétique.
- **Police** : choix parmi des piles CSS sûres, les polices du jeu n'étant pas
  distribuées.

## 4. Découpage

1. **Modèle et migration** — types, valeurs par défaut, `mergeSettings`, tests.
2. **UI 4 onglets** — composants segmentés, curseurs, radios, capture de touches,
   réinitialisation, tests jsdom.
3. **Lecture et affichage** — vitesses lu/non lu, page entière, délais auto, clic auto,
   skip automatique, fondu du texte lu, police, animations, effets.
4. **Système et audio** — plein écran, taille, souris, volumes/mutes/test.
5. **Raccourcis** — table configurable, capture, actions, tests.
6. **Documentation et vérification** — `KAG_MAHOYO_SEMANTICS.md`, `BUGS_PROLOGUE.md`
   si nécessaire, `tsc`, `test:unit`, `test:integration`, `build`, `check:assets`.

Critère de fin : les quatre onglets reprennent tous les réglages des captures, chaque
réglage a un effet observable (ou une adaptation web documentée), la config survit au
rechargement et les anciennes sauvegardes restent lisibles.

## 5. État d'implémentation (2026-11-08)

| Bloc | Fichiers | État |
|---|---|---|
| Modèle et migration | `src/renderer/types.ts`, `src/player/settings-store.ts` | fait (anciens `textSpeed`/`autoDelay` et « Muet » global migrés) |
| Raccourcis | `src/core/shortcuts.ts`, `src/ui/ui-manager.ts` | fait (14 actions, deux touches, capture, réinitialisation) |
| Écran 4 onglets | `src/ui/ui-manager.ts`, `src/ui/ui-manager.css` | fait (segments, curseurs, cases, sélecteurs, pied de page fixe) |
| Lecture et affichage | `src/ui/player.ts`, `src/renderer/stage-renderer.ts` | fait (vitesses lu/non lu, page entière, délais page/ligne, clic auto, skip automatique, avance rapide, police, fondu, effets) |
| Système | `src/core/display.ts`, `src/ui/player.ts` | fait (plein écran fit/fill/1:1, plafond de taille, souris, curseur) |
| Audio | `src/renderer/audio-manager.ts` | fait (BGM/SE/système, mutes, test SE synthétique) |

Vérifications : `tsc`, `npm run build`, **921** tests unitaires, 15 tests d'intégration,
`check:assets`. Contrôle Chromium 1280×720 : quatre onglets, capture d'une touche
persistée, taille 640×360 → `scale(0.5)`, test SE sans erreur, clic droit → menu,
`S` → sauvegarde, `C` → options, `Delete`/`Backspace` → masquage, `R` → historique,
`F4` → plein écran, texte lu à l'opacité réglée (20 % vérifié).

Divergences assumées : `stopAnimations` vaut `true` par défaut pour garder l'ouverture
sautable (la capture montre « Non ») ; le volume système est mémorisé mais aucun son
d'interface n'est encore émis ; la taille de fenêtre plafonne l'affichage au lieu de
redimensionner la fenêtre du système ; « Quitter » utilise `window.close()` avec repli
sur un message.
