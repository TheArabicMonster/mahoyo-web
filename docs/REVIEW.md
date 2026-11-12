# Mode revue : flags en jeu + lanceur `npm run review` (#400)

Mode destiné au **propriétaire** : jouer au jeu et marquer les passages à problème (F2), puis
envoyer une session JSON exploitable (script, position d'instruction, état scène, capture).
Tout reste **local** (localStorage + IndexedDB) : aucun envoi réseau, aucun asset/texte commité.

## Lancer : deux modes

### Mode automatique (défaut)

```bash
# Construit l'app, sert dist/ en local et ouvre un navigateur visible Playwright
npm run review

# Avec les assets réels locaux du propriétaire (public/assets, non commités)
npm run review -- --assets /chemin/vers/public

# Tester un déploiement existant (pas de build ni de serveur local)
npm run review -- --url https://exemple.test/game/
```

La session est **sauvegardée à chaque flag** dans `reports/review-session.json` (+
`reports/review-shots/`) : même si la fenêtre se ferme, les flags déjà posés sont sur disque. La
raison de fin est journalisée (`page.close` / `page.crash` / `browser.disconnected`).

### Mode manuel (`--manual`, alias `--no-open`) — recommandé si la fenêtre se ferme seule

```bash
npm run review -- --manual
```

**Aucune fenêtre Playwright** n'est lancée : le script démarre le serveur (ou utilise `--url`) et
affiche l'URL `?review=1` à ouvrir dans **votre** navigateur. Marquez avec F2, puis récupérez le JSON
avec **F3** (téléchargement de `review-session.json`, captures incluses) ou **F4** (copie). `Ctrl+C`
arrête le serveur. C'est le mode recommandé en cas de fermeture intempestive de la fenêtre
automatique (bug connu non reproduit localement, #405).

| Option | Effet |
|---|---|
| `--manual` / `--no-open` | pas de Playwright : URL à ouvrir soi-même, JSON via F3 |
| `--url <url>` | teste une URL existante (aucun build/serveur local) |
| `--port N` | port du serveur local (`vite preview`) ; défaut : port libre |
| `--browser chromium\|firefox` | navigateur **visible** (défaut chromium) |
| `--assets <dir>` | dossier `public` contenant `assets/` (build lié par symlinks, pas de copie) |
| `--no-build` | réutilise `dist/` existant |
| `--no-console-log` | ne pas écrire `reports/review-console.log` |
| `--out <dir>` | dossier des rapports (défaut `reports/`) |

Alternative : ouvrir le jeu avec `?review=1` (alias `?mark=1`) dans un navigateur classique.

## Aide et focus (premier lancement)

Au premier lancement d'une session, un **overlay d'aide** rappelle : **F2**/bouton ⚑ Marquer, catégories **1–7**,
**Entrée** valide, **F3** export, **F4** copie, et « **fermez le navigateur pour terminer** ».
Il est dismissible (Entrée/Échap/clic) et n'est plus réaffiché avant la prochaine session
(`sessionStorage`). Le HUD reste visible en permanence : « ⚑ Marquer (F2) », compteur de flags,
« Exporter (F3) » et « ? » (réafficher l'aide).

Le lanceur donne le focus à la page après chargement (`bringToFront()` + clic dans la page).
**Si aucune touche ne répond, cliquez une fois dans la page** : le jeu reçoit alors le clavier.

En mode revue, le **service worker PWA n'est pas enregistré** : la console du lanceur reste propre
(pas d'erreur MIME `/sw.js` ni d'avertissement PWA). Après un flag, un toast confirme
« Flag #N enregistré — Catégorie » et le compteur du HUD s'incrémente.

## Marquer un passage

1. **F2** : le jeu se met en pause courte, un panneau s'ouvre.
2. Touches **1–7** : catégorie — **Texte / Sprite / Fond / Transition / Son / Icône / Autre**.
3. Note libre optionnelle (ce qui cloche, attendu…).
4. **Entrée** enregistre le flag (capture d'écran html2canvas, JPEG q0.8, largeur max 960).
   **Échap** annule, le jeu reprend.
5. **F3** télécharge `review-session.json` (captures inline) ; **F4** copie le même JSON.

Le HUD discret en haut à droite (« Revue ⚑ n ») permet aussi d'ouvrir le panneau et de consulter /
supprimer les derniers flags. **Sans `?review=1`, rien n'est monté** (aucun nœud, aucun écouteur).

Chaque flag contient :
- horodatage ISO + temps de session, route/hash, écran ;
- **script + position d'instruction** (`scriptName`, page, index d'instruction, segment) et texte
  source courant ;
- état scène : fond (storage, left/top, zoom, rotation), sprites (id, storage, x/y/z/opacité),
  calques de timeline, transition en cours (méthode, durée, écoulé) ;
- audio (canaux actifs + volumes), réglages utiles (langue, volumes, viewport, DPR, `assetsVersion`) ;
- capture JPEG (IndexedDB), derniers warnings/erreurs console et requêtes en échec
  (`responseStatus ≥ 400`).

## Récupérer la session

- **F3 / F4** dans le jeu : JSON complet avec captures (bouton « Exporter (F3) » équivalent) —
  c'est la **seule** récupération en mode manuel ;
- **Mode automatique** : `reports/review-session.json` est réécrit **à chaque flag** (sauvegarde
  incrémentale) puis à la fermeture, avec `reports/review-shots/<id>.jpg` et le résumé
  (nombre de flags, pages/scripts concernés) ; la raison de fin est incluse (`endReason`, `durationMs`).
- `reports/review-console.log` : journal continu console (warn/error), `pageerror` et réponses
  HTTP ≥ 400 (404 d'assets), sauf `--no-console-log`.

Le propriétaire peut alors envoyer `reports/review-session.json` (captures incluses) pour l'analyse.

### Si le lanceur termine avec 0 flag

Le lanceur affiche une aide explicite au lieu d'un simple « Aucun flag posé » :
démarrer une partie (Start) ou charger une sauvegarde, cliquer une fois dans la page si les touches
ne répondent pas, puis **F2 → catégorie (1–7) → note → Entrée** ; fermer le navigateur termine la
session et récupère les flags.

## Développement

- `src/ui/review-mode.ts` : HUD/panneau/raccourcis, stockage, captures, export, résumé (helpers purs
  testés) ; monté par `src/main.ts` uniquement si `isReviewMode(location.search)`.
- `src/ui/player.ts` : `reviewSnapshot()` (lecture seule) et `reviewPause()` (pause courte).
- `src/renderer/stage-renderer.ts` : `reviewState()` (calques de timeline + transition en cours).
- `tools/review.ts` + `tools/review-lib.ts` : lanceur et helpers purs (options, URL, résumé).
- Tests : `tests/unit/ui/review-mode.test.ts`, `tests/unit/tools/review-lib.test.ts`.

> Rappel : aucun asset ni texte du jeu n'est commité ; les captures et sessions restent sous
> `reports/` (ignoré par git) ou dans le navigateur.
