# Guide de captures — écrans complémentaires de l'original

Issue : **#187 (HUD-17)** — action du propriétaire, prérequis de **#213 (HUD-18, écran de choix)**.
Document de référence : [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md) §6 (15 points non vérifiables) et §4
(écarts E10, E32, E33…).

> **But** : obtenir du propriétaire, qui possède le jeu PC 2012, de courtes captures des écrans et
> comportements que la vidéo d'analyse ne montre pas. L'agent en extrait ensuite des **mesures**
> (positions, couleurs hex, durées, cadences) et met à jour la documentation **en texte uniquement**.
> Aucune image, capture, ni texte du jeu n'est commité dans le dépôt.

**Aucun merge n'est demandé au propriétaire** : il enregistre les captures, les dépose hors dépôt, et
l'agent reprend ensuite la documentation (#187 étape 2) puis l'écran de choix (#213).

## 1. Avant de commencer

- **Jeu** : copie personnelle de *Mahoyo* PC 2012, **patch français Moon-Trad installé**, interface en
  **français** (les captures servent aussi aux libellés de l'interface).
- **Affichage** : plein écran, **1920×1080** si possible (sinon 1280×720 ou résolution native — notez-la).
  Ne pas recadrer, redimensionner ni recompresser les fichiers.
- **Capture** : OBS Studio (MP4/MKV, H.264), ou l'outil système (Xbox Game Bar, QuickTime). **60 fps
  recommandé** (30 fps acceptable, sauf pour le point 14), **audio activé** (voix de l'historique, sons).
- **Confidentialité** : ne saisir aucun texte personnel (noms, commentaires de sauvegarde, etc.) et ne
  filmer aucun contenu hors du jeu.
- **Dossier local hors dépôt** : par exemple `~/mahoyo-captures/` (ou `%USERPROFILE%\mahoyo-captures\`
  sous Windows), avec un sous-dossier par scénario. **Ne jamais copier ces fichiers dans le dépôt git.**
- **Nommage** : `NN-scenario.mp4` (`01-ecran-choix.mp4`, `02-ecran-save.mp4`…), et éventuellement un
  `NN-notes.txt` local décrivant ce qui a été fait. Pas de capture ni de notes commitées.

## 2. Format et livraison

| Élément | Recommandation |
|---|---|
| Type | Vidéo pour les animations/transitions ; PNG pleine résolution accepté pour un écran fixe |
| Résolution | 1920×1080 (ou native, à préciser) |
| Cadence | 60 fps (30 fps minimum ; 120/240 fps si disponible pour le point 14) |
| Durée | 5 à 20 s par séquence, sauf indication contraire (point 12 : ≥ 10 s ; point 13 : ≥ 3 s par attente) |
| Format | MP4/MKV (H.264) ou PNG ; pas de recadrage, pas de GIF |
| Audio | Activé (voix, sons, musique) ; pas de micro |
| Langue | Interface en français (patch FR) |

**Livraison** (au choix, jamais dans le dépôt) :

1. **Joindre les fichiers** au fil de discussion de l'issue #187 (ou de la PR de documentation) — les
   pièces jointes GitHub restent hors dépôt ; ou
2. **Indiquer le chemin local** du dossier (ex. `/Users/<nom>/mahoyo-captures/`) si l'agent travaille sur
   la même machine et peut les lire directement.

Un simple index local (`INDEX.txt`) listant « fichier → scénario » suffit ; il ne doit contenir **aucun
texte du jeu**, seulement vos descriptions.

## 3. Ordre conseillé

1. **Priorité absolue : scénario 1 (écran de choix)** — il débloque **#213**. Si vous ne devez faire
   qu'une capture, faites celle-là.
2. Puis 2, 3, 4, 6, 7, 8, 9, 10 (écrans et états du HUD).
3. Enfin 5, 11, 12, 13, 14, 15 (mesures, raccourcis, courbes, configuration).

## 4. Scénarios à enregistrer

Pour chaque scénario : ce qu'il faut montrer, comment y accéder, durée indicative et ce que la capture
permet de mesurer. Les numéros renvoient aux points de [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md) §6.

### 1. Écran de choix — **priorité #213** (§6.1, §4 E33)

- **Montrer** : l'écran de choix complet avec **toutes les options visibles**, le **curseur d'origine**,
  le **survol** de chaque option (passer lentement sur chacune), l'**animation d'apparition**, puis
  valider un choix.
- **Comment** : depuis une sauvegarde ou le début, jouer jusqu'au **premier choix** du prologue ; filmer
  à partir de ~2 s avant l'apparition des options.
- **Durée** : 15–20 s, 60 fps ; optionnel : PNG fixe écran complet + curseur.
- **Permet de mesurer** : positions/tailles des options, couleur et forme du curseur, couleurs de survol,
  durée et courbe de l'animation, ordre des options.
- **Débloque** : #213 (HUD-18).

### 2. Écran Save et confirmations (§6.2, §4 E10/E12/E36)

- **Montrer** : menu système → **save** ; la grille (emplacements auto/rapide, pagination 15 pages),
  l'écran de confirmation d'**écrasement**, un **emplacement verrouillé**, puis annuler.
- **Comment** : clic droit (menu système) → *Save* ; sans écraser de sauvegarde réelle. Pour le verrou,
  utilisez un emplacement déjà verrouillé, ou montrez l'absence de verrou si vous n'en avez pas.
- **Durée** : 20–30 s.
- **Permet de mesurer** : gabarit, ordre des emplacements, boutons, libellés, apparence du verrou.
- **Confirme/corrige** : E10, E12, E36 ; complète HUD-10.

### 3. Cartes de titre de chapitre et transitions (§6.3)

- **Montrer** : le **début d'un chapitre** (carte de titre) et la transition qui y mène.
- **Comment** : commencer une nouvelle partie ou enchaîner un chapitre ; filmer la fin de scène jusqu'à
  l'apparition du titre.
- **Durée** : 10–15 s.
- **Permet de mesurer** : position/typographie de la carte, durée et type de transition.

### 4. Indicateurs auto / skip (§6.4, §4 E32)

- **Montrer** : activation de **auto** puis de **skip** depuis le menu système, avec l'**indicateur à
  l'écran** pendant l'action.
- **Comment** : menu système → *Auto* (filmer ~5 s), revenir, puis *Skip* (filmer ~5 s).
- **Durée** : 10–15 s au total.
- **Permet de mesurer** : position, forme, couleur, animation des indicateurs.

### 5. Archive déverrouillée (§6.5, §4 E19)

- **Montrer** : sous-menu **Extra → Archive** avec des chapitres **déverrouillés** (grille de « livres »),
  les chapitres verrouillés, et le retour.
- **Comment** : depuis l'écran titre, ouvrir Extra → Archive (après avoir lu au moins un chapitre).
- **Durée** : 10–15 s.
- **Permet de mesurer** : grille, vignettes, états verrouillé/déverrouillé, navigation.

### 6. Écran de fin / crédits (§6.6)

- **Montrer** : l'écran de fin et le **générique** (défilement), jusqu'au retour au titre si possible.
- **Comment** : depuis une sauvegarde proche de la fin, ou en laissant se terminer la dernière scène.
- **Durée** : 20–30 s (le générique peut être long : filmez le début, la fin et le retour).
- **Permet de mesurer** : présentation, typographie, défilement, durée, retour.

### 7. Entrée *graphic* du menu système (§6.7, §5.6)

- **Montrer** : menu système → **graphic** ; l'effet réel (masquage du texte pour voir l'image ?), le
  retour, et si l'entrée change d'état.
- **Comment** : en jeu, clic droit → *graphic* ; filmer avant/pendant/après.
- **Durée** : 10 s.
- **Permet de mesurer** : comportement, libellé d'état, transition.

### 8. Historique (backlog) — luminosités et clic (§6.8, §4 E13)

- **Montrer** : l'historique en jeu, les **deux niveaux de luminosité** des entrées, le **clic** sur une
  entrée (que se passe-t-il ?), et **les voix** éventuelles (audio activé).
- **Comment** : menu système ou raccourci → *Historique* ; survoler/cliquer une entrée.
- **Durée** : 15–20 s, audio activé.
- **Permet de mesurer** : contraste des deux niveaux, comportement au clic, présence des voix.

### 9. États désactivés du menu système (`@lockquickmenu`) (§6.9)

- **Montrer** : une séquence où **save/load sont verrouillés** dans le menu système (entrées grisées ou
  absentes), puis leur retour à l'état actif.
- **Comment** : lors d'un moment du jeu qui verrouille le menu rapide (par ex. une scène d'animation ou
  une transition) ; ouvrir le menu système pendant ce moment.
- **Durée** : 10 s.
- **Permet de mesurer** : style des entrées désactivées, ordre, comportement.

### 10. Boutons survolés (§6.10, §4 E15)

- **Montrer** : survol **lent** de chaque type de bouton/organe : bascules de la configuration,
  *Supprimer*, *Charger*, boutons de l'écran de chargement, entrées de menu.
- **Comment** : ouvrir la configuration et l'écran de chargement ; survoler chaque contrôle ~1 s.
- **Durée** : 20–30 s.
- **Permet de mesurer** : couleurs exactes de survol (hex), bordures, transitions ; tokens manquants
  (`DESIGN.md` §2/§8/§11).

### 11. Position verticale du texte (§6.11, §4 E1)

- **Montrer** : **plusieurs scènes différentes** (avec/sans nom de locuteur, fonds variés), texte complet
  affiché, **sans cliquer** pendant l'affichage.
- **Comment** : 3 ou 4 séquences de 5–10 s à des moments différents du jeu.
- **Permet de mesurer** : règle d'ancrage du texte (haut vs centré selon la scène), marges.

### 12. Vitesse de frappe réelle (§6.12)

- **Montrer** : une page de texte qui s'affiche **sans aucun clic**, avec la **vitesse par défaut**,
  pendant **au moins 10 s** (temps complet de frappe).
- **Comment** : ne pas toucher au clavier ni à la souris pendant l'affichage ; filmer du début à la fin.
- **Durée** : ≥ 10 s (idéalement la page entière).
- **Permet de mesurer** : cadence réelle (caractères/seconde), durée de la page.

### 13. Raccourcis réels et sprites d'attente (§6.13)

- **Montrer** : appui sur **chaque touche** listée dans l'onglet *Raccourcis* de la configuration, avec le
  résultat à l'écran (une courte séquence par raccourci ou une seule vidéo avec les libellés).
- **Montrer aussi** : l'**animation des sprites d'attente** (feuille/livre) pendant **≥ 3 s** sans cliquer.
- **Comment** : configurer les raccourcis comme à l'origine puis les tester en jeu ; une vidéo par groupe
  de raccourcis est plus lisible.
- **Durée** : 3–5 s par raccourci + 3 s d'attente.
- **Permet de mesurer** : correspondances réelles des touches, fréquence/ordre de l'animation d'attente.
- **Confirme/corrige** : raccourcis de `config.shortcuts`.

### 14. Courbes d'animation des menus (§6.14, §4 E23)

- **Montrer** : ouverture/fermeture du **menu système** et de la **configuration**, en **haute cadence**
  (60 fps minimum ; 120/240 fps si l'outil le permet), sans compression agressive.
- **Comment** : filmer chaque ouverture/fermeture, éventuellement en rejouant 2–3 fois.
- **Durée** : 5 s par animation.
- **Permet de mesurer** : durée exacte (270 ms observés), rampe (linéaire ou courbe), voile/fondu.

### 15. Page *Message* de la config ouverte depuis le jeu (§6.15, §4 E15)

- **Montrer** : la **configuration ouverte depuis le jeu** (pas depuis l'écran titre), en particulier
  l'onglet **Message** et les **4 onglets** disponibles.
- **Comment** : en jeu, menu système → *Config* ; parcourir les 4 onglets.
- **Durée** : 15–20 s.
- **Permet de mesurer** : contenu/ordre des onglets en jeu, différences avec le titre.

## 5. Checklist de collecte

Cocher chaque scénario une fois le fichier capturé et déposé hors dépôt. Les points 1 à 15 renvoient à
[`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md) §6 ; « #213 » = déblocage de l'écran de choix.

| Fait | # | Scénario | Réf. §6 | Débloque | Fichier attendu (exemple) |
|---|---|---|---|---|---|
| [ ] | 1 | Écran de choix complet (options, curseur, survol, animation) | §6.1 | **#213**, E33 | `01-ecran-choix.mp4` |
| [ ] | 2 | Écran Save, écrasement, emplacement verrouillé | §6.2 | E10/E12/E36 | `02-ecran-save.mp4` |
| [ ] | 3 | Carte de titre de chapitre + transition | §6.3 | HUD fidélité | `03-titre-chapitre.mp4` |
| [ ] | 4 | Indicateurs auto / skip | §6.4 | E32 | `04-auto-skip.mp4` |
| [ ] | 5 | Archive déverrouillée | §6.5 | E19 | `05-archive.mp4` |
| [ ] | 6 | Écran de fin / crédits | §6.6 | HUD fidélité | `06-fin-credits.mp4` |
| [ ] | 7 | Entrée *graphic* du menu système | §6.7 | §5.6 | `07-graphic.mp4` |
| [ ] | 8 | Historique : 2 luminosités, clic, voix | §6.8 | E13 | `08-historique.mp4` |
| [ ] | 9 | États désactivés (`@lockquickmenu`) | §6.9 | menu système | `09-menu-verrouille.mp4` |
| [ ] | 10 | Boutons survolés (config, Supprimer/Charger) | §6.10 | E15, tokens | `10-survols.mp4` |
| [ ] | 11 | Position verticale du texte (plusieurs scènes) | §6.11 | E1 | `11-texte-*.mp4` |
| [ ] | 12 | Vitesse de frappe réelle (≥ 10 s sans clic) | §6.12 | E1/HUD-04 | `12-frappe.mp4` |
| [ ] | 13 | Raccourcis réels + sprites d'attente (≥ 3 s) | §6.13 | raccourcis | `13-raccourcis-*.mp4` |
| [ ] | 14 | Courbes d'animation menus (haute cadence) | §6.14 | E23 | `14-courbes.mp4` |
| [ ] | 15 | Config *Message* ouverte depuis le jeu (4 onglets) | §6.15 | E15 | `15-config-en-jeu.mp4` |

**Minimum pour débloquer #213 : scénario 1 uniquement.**

## 6. Ce qui se passe ensuite (étape agent)

Après réception, l'agent :

1. mesure sur les captures : positions relatives (repère 1024×576 du stage web), couleurs hex, durées,
   cadences, courbes (échantillonnage image par image) ;
2. met à jour [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md) §4 (écarts E10, E32, E33…) et §6, et
   [`DESIGN.md`](DESIGN.md) (§2 palette, §8 états, §11 tokens) **en texte et valeurs uniquement** ;
3. re-classe explicitement en « non vérifiable » tout point qu'aucune capture ne permet de mesurer, avec
   la raison ;
4. ne commit **jamais** les fichiers de capture : ils restent locaux, et ne sont joints qu'au fil de
   discussion/PR si nécessaire.

## 7. À ne pas faire

- Ne **pas** commiter de capture, recadrage, image, dialogue ou traduction du jeu dans le dépôt.
- Ne **pas** coller de texte du jeu dans les commentaires/PR : décrire les écrans (positions, couleurs,
  durées) suffit.
- Ne **pas** saisir de données personnelles à l'écran.
- Ne **pas** redimensionner/recadrer/compresser les fichiers avant envoi (l'agent a besoin de la
  résolution native et de la cadence d'origine).

## 8. Suivi

- Issue action utilisateur : **#187** (HUD-17) — cette PR ne la ferme pas.
- Écran de choix bloqué : **#213** (HUD-18) — débloqué dès réception du scénario 1.
- Points d'analyse : [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md) §6 (état « non vérifié » tant que
  les captures ne sont pas traitées).
