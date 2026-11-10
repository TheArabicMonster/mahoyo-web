# Validation visuelle automatisée (#347)

Outil de **validation visuelle reproductible** des correctifs sprite (#315) et transitions (#316),
sans nouvel enregistrement du propriétaire : on capture le build courant avec les **assets réels
locaux** (jamais commités) et on le compare à l'enregistrement de référence
(`/tmp/mahoyo-cmp/real.mov`, 256 frames extraites) avec des mesures chiffrées.

> Outil de **diagnostic** : il ne modifie pas le runtime et n'échoue pas la CI. Les captures et
> rapports restent **hors dépôt** (`/tmp/mahoyo-visual`).

## Commande

```bash
# Assets réels locaux requis (le dossier parent de assets/ : public/)
MAHOYO_E2E_ASSETS=/chemin/vers/public npm run validate:visual
```

| Option | Effet |
|---|---|
| `--assets <dir>` | dossier `publicDir` contenant `assets/` (défaut : `MAHOYO_E2E_ASSETS` ou `public`) |
| `--out <dir>` | dossier des captures/rapport (défaut `/tmp/mahoyo-visual`) |
| `--reference <jpg>` | frame de référence (défaut `/tmp/mahoyo-cmp/real-f/f_0256.jpg`) |
| `--max-presses N` | borne d'avancées de texte pour atteindre la pose (défaut 400) |
| `--strict` | code de sortie 1 si un seuil n'est pas respecté (défaut : diagnostic, exit 0) |

Sortie : `scene-big.png` (pose du plan rapproché), `scene-near.jpg`, `frames/*.jpg` (séquence
~12 Hz), `rapport.json` (toutes les mesures) et la console (synthèse). **Aucun fichier n'est écrit
dans le dépôt.**

## Méthode

1. **Capture** : le player est lancé sur un serveur Vite dédié avec `MAHOYO_E2E_ASSETS` (assets
   réels). La table d'enchaînement est forcée à démarrer sur `1-2.ks` (arrivée au lycée), segment qui
   couvre la fin de l'enregistrement de référence. Le script avance le texte (Entrée) jusqu'à ce que
   le sprite `山城01(大)` et `im14青子背中(制服)` soient présents (plan rapproché du professeur),
   en capturant une image à chaque itération (~80 ms) pour les analyses temporelles.
2. **Sprite (#315)** : corrélation de modèle (NCC) dans Chromium (canvas) entre la frame de
   référence normalisée 1280×720 et la capture :
   - **décor** : zone bureau/étagère (560,380,240×140) → transformation décor→capture ;
   - **sprite** : buste du professeur (900,260,140×140) → transformation sprite→capture ;
   - on applique les deux transformations au **nœud de cravate** (point de contrôle 940,330) :
     l'écart relatif sprite↔décor est le défaut d'alignement. Critère #315 : **≤ 1 %** de la
     largeur et de la hauteur (12,8 px / 7,2 px en 1280×720).
3. **Transitions (#316)** :
   - **durées demandées** : les animations WAAPI du renderer sont observées à chaque image
     (`document.getAnimations()`, `effect.getTiming().duration`) → elles doivent être **exactement**
     `time=` du script (`@trans`/`@bg`) ;
   - **durées mesurées** : début/fin observés sur la timeline (précision ≈ 1 image de capture) ;
   - **fondus** : rampes de luminosité moyenne de la scène sur la séquence d'images ;
   - **cuts parasites** : sauts isolés de luminosité (> 25 % en une image) hors rampe ;
   - comparaison à la référence : `real.mov` échantillonné à 10 fps par la même métrique
     (l'enregistrement contient 6 fondus et **aucun cut** sur 128,2 s).

## Résultats de référence (2026-11-10, assets réels locaux, macOS)

| Mesure | Valeur | Critère | Verdict |
|---|---|---|---|
| Score décor (NCC) | 98,2 % (échelle ×1,000) | — | alignement fiable |
| Score sprite (NCC) | 90,1 % | — | alignement fiable |
| Écart cravate vs décor — horizontal | **−10,0 px (0,78 %)** | ≤ 1 % | **OK** |
| Écart cravate vs décor — vertical | **−42,0 px (5,83 %)** | ≤ 1 % | **HORS TOLÉRANCE** |
| Durées demandées vs `time=` | 600/1200/300/850 ms exacts, 9/11 appariés | = `time=` | **OK** |
| Durées mesurées vs demandées | 600→661, 1200→1266, 600→628… (±1 image) | ±1 image | **OK** |
| Fondus détectés | 8 rampes (dont 1000/1100 ms) | ≥ 3 | **OK** |
| Cuts parasites | **1** (13,88 s : apparition du partbg du bureau) | 0 | **HORS TOLÉRANCE** |
| Référence (10 fps) | 6 fondus, **0 cut** | — | comparaison |

### Interprétation

- **#315** : l'horizontal est aligné (0,78 %), mais le sprite est encore **~42 px trop haut**
  (5,8 % de la hauteur) par rapport au décor au plan rapproché. Cause probable à instruire côté
  runtime : ancrage `vcenter` du `@fg storage=山城01(大)` (le port place `top = vcenter − h/2` en px
  du stage, l'original semble poser le sprite ~34 px de stage plus bas), ou interaction
  `@partbg`/`partbgid`. **Critère non atteint : ne pas fermer #315 en l'état.**
- **#316** : les durées de transition sont **conformes** (`time=` appliqué exactement, durée
  observée ±1 image) et 8 fondus sont détectés ; mais un **cut franc** subsiste à l'apparition du
  fond `partbg` du bureau (13,88 s) alors que la référence n'en a aucun. **À instruire : ne pas
  fermer #316 en l'état.**

## Limites

- La frame de référence et l'enregistrement vivent **hors dépôt** (`/tmp/mahoyo-cmp`) : sans eux,
  l'outil se rabat sur les transitions seules (avertissement explicite).
- L'enregistrement de référence est la version **anglaise** du jeu ; les textes diffèrent (non
  utilisés dans les mesures) et les scripts peuvent différer légèrement (hypothèse retenue pour
  expliquer une partie de l'écart vertical).
- La mesure temporelle a la précision d'une image de capture (~80 ms) ; les sessions d'animation
  interrompues entre deux observations sont marquées « n/a » plutôt que faussées.
- Les scores NCC dépendent du flou/cadrage de la vidéo de référence ; les deux zones retenues
  (bureau/étagère, buste) gardent des scores ≥ 90 %.
- Aucun asset ni capture n'est commité ; la validation complète nécessite les assets réels locaux
  (donc hors CI, comme demandé).
