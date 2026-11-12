# Mode revue : flags en jeu + lanceur `npm run review` (#400)

Mode destiné au **propriétaire** : jouer au jeu et marquer les passages à problème (F2), puis
envoyer une session JSON exploitable (script, position d'instruction, état scène, capture).
Tout reste **local** (localStorage + IndexedDB) : aucun envoi réseau, aucun asset/texte commité.

## Lancer

```bash
# Recommandé : construit l'app, sert dist/ en local et ouvre un navigateur visible
npm run review

# Avec les assets réels locaux du propriétaire (public/assets, non commités)
npm run review -- --assets /chemin/vers/public

# Tester un déploiement existant (pas de build ni de serveur local)
npm run review -- --url https://exemple.test/game/

# Options
npm run review -- --browser firefox --port 4321 --no-build --no-console-log
```

| Option | Effet |
|---|---|
| `--url <url>` | teste une URL existante (aucun build/serveur local) |
| `--port N` | port du serveur local (`vite preview`) ; défaut : port libre |
| `--browser chromium\|firefox` | navigateur **visible** (défaut chromium) |
| `--assets <dir>` | dossier `public` contenant `assets/` (build lié par symlinks, pas de copie) |
| `--no-build` | réutilise `dist/` existant |
| `--no-console-log` | ne pas écrire `reports/review-console.log` |
| `--out <dir>` | dossier des rapports (défaut `reports/`) |

Alternative : ouvrir le jeu avec `?review=1` (alias `?mark=1`) dans un navigateur classique.

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

- **F3 / F4** dans le jeu : JSON complet avec captures.
- **Fermeture du navigateur lancé par `npm run review`** : le lanceur écrit automatiquement
  `reports/review-session.json` (captures inline) + `reports/review-shots/<id>.jpg` + résumé
  (nombre de flags, pages/scripts concernés).
- `reports/review-console.log` : journal continu console (warn/error), `pageerror` et réponses
  HTTP ≥ 400 (404 d'assets), sauf `--no-console-log`.

Le propriétaire peut alors envoyer `reports/review-session.json` (captures incluses) pour l'analyse.

## Développement

- `src/ui/review-mode.ts` : HUD/panneau/raccourcis, stockage, captures, export, résumé (helpers purs
  testés) ; monté par `src/main.ts` uniquement si `isReviewMode(location.search)`.
- `src/ui/player.ts` : `reviewSnapshot()` (lecture seule) et `reviewPause()` (pause courte).
- `src/renderer/stage-renderer.ts` : `reviewState()` (calques de timeline + transition en cours).
- `tools/review.ts` + `tools/review-lib.ts` : lanceur et helpers purs (options, URL, résumé).
- Tests : `tests/unit/ui/review-mode.test.ts`, `tests/unit/tools/review-lib.test.ts`.

> Rappel : aucun asset ni texte du jeu n'est commité ; les captures et sessions restent sous
> `reports/` (ignoré par git) ou dans le navigateur.
