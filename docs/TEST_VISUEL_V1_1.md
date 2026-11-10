# Checklist de test visuel — v1.1

Document de recette manuelle pour le propriétaire. Chaque point indique **où**, **quoi faire**
et **critère d'acceptation** ; en cas d'écart, noter le numéro (ex. `TEX-03 KO : le mot se coupe
encore à la ligne 2`) et, si possible, une capture vidéo courte hors dépôt.

> Rappel : ce document ne remplace pas les tests automatiques (2 344 tests unitaires, 199+ e2e,
> `audit:guard` zéro strict). Il cible ce qu'un test ne peut pas juger : la **fidélité visuelle**
> à l'original.

## 0. Préparation

- [ ] `git pull`, `npm ci`, assets réels en place, `npm run dev` (ou build de production).
- [ ] Résolution **1280×720**, puis **1920×1080** (deux passes si possible).
- [ ] Navigateur **Chromium** puis **Firefox** (les deux sont supportés).
- [ ] Console ouverte (F12) : aucune erreur rouge pendant la session.
- [ ] Audio activé (BGM/SFX/voix).

## 1. Texte (correctifs #314/#320)

- [ ] **TXT-01** Prologue : la frappe normale ne « reflow » plus — les mots ne changent pas de place
      et ne se coupent pas au milieu pendant la saisie ; le texte déjà affiché reste stable.
- [ ] **TXT-02** La **taille de police ne rétrécit jamais**, même sur une page longue (la page doit
      se découper/paginer, jamais réduire la police). Comparer avec l'original.
- [ ] **TXT-03** Les retours à la ligne tombent aux **mêmes endroits** que dans l'original sur le
      prologue (marges gauche/droite ~69 px logique, 86 px écran).
- [ ] **TXT-04** La **position verticale** du texte et l'interligne sont corrects (pas collé au bord,
      pas d'espacement excessif).
- [ ] **TXT-05** Les **rubis** (furigana / annotations) sont au-dessus du bon caractère, et un rubi
      posé sur une image inline `[graph]` (emoji/cœur) entoure l'image, pas le texte suivant.
- [ ] **TXT-06** Le **texte du narrateur** (sans encadré) s'affiche correctement, sans cadre parasite.
- [ ] **TXT-07** Une page très longue : le texte est **coupé proprement** (pas de débordement hors
      zone, pas de rétrécissement) ; le clic avance bien à la page suivante.
- [ ] **TXT-08** Vitesse de frappe : les caractères apparaissent au rythme prévu (config Message) ;
      clic = afficher tout ; « auto » fonctionne si activé.

## 2. Sprite du professeur et personnages (correctif #315/#327)

- [ ] **SPR-01** Plan rapproché du professeur : le **nœud de cravate** doit rester aligné avec le
      décor de fond (≤ 1 % d'écart), comme dans l'original — c'était le bug principal.
- [ ] **SPR-02** Entrées/sorties de personnages : position, taille et point d'ancrage corrects
      (pas de sprite décalé vers le haut/gauche, pas de personnage flottant).
- [ ] **SPR-03** `@chgfg` (changement de visage/pose) : le personnage **garde sa position** quand le
      visage change ; pas de « saut » ni de recentrage.
- [ ] **SPR-04** Zoom/rotation/pivot d'un sprite : rendu correct, pas de déformation ni de décalage.
- [ ] **SPR-05** `partbgid` (sprite clippé dans une fenêtre) : le sprite est bien découpé, rien ne
      dépasse de la fenêtre.
- [ ] **SPR-06** Sprite présent sur les deux pages (fore/back) pendant une transition : pas de ghost,
      pas de flash.

## 3. Fond et panoramiques (correctif #317/#328/#339)

- [ ] **BGD-01** Un fond animé `@bgact` (plusieurs keyframes) **bouge réellement** : panoramique,
      zoom ou rotation visible, fluide, sans à-coup.
- [ ] **BGD-02** Les panoramiques ont la **bonne accélération** (`accel`) : départ/arrivée doux ou
      linéaires comme l'original, pas de saut brusque à la fin.
- [ ] **BGD-03** Ouvrir une **sauvegarde en plein panoramique** : le fond reprend à l'**état final**
      (position finale), pas au début.
- [ ] **BGD-04** Pendant un panoramique, les sprites de la page (`@bindbg`) suivent correctement.
- [ ] **BGD-05** Fond + transition simultanés : pas de flash, pas de retour en arrière du panoramique.

## 4. Transitions (correctifs #316/#328/#339)

- [ ] **TRN-01** Les fondus (`@trans`) durent **exactement** la durée du script (`time=`) : plus de
      cut/fondu interrompu au milieu, notamment lors des animations de calque (`@movefg`, `@fgact`).
- [ ] **TRN-02** Pas de **cut supplémentaire** dans l'ouverture : comparer le rythme avec l'original
      (les animations de calque ne coupent plus les fondus).
- [ ] **TRN-03** `@trans nowait` : le jeu n'attend pas ; l'échange fore/back se fait sans artefact
      visible ; enchaînement correct avec `@wt`.
- [ ] **TRN-04** Règles de transition (crossfade, universel, etc.) : rendu visuel attendu.
- [ ] **TRN-05** « Clic pour accélérer » : ne coupe plus les fondus (comportement d'origine) ;
      vérifier aussi que le texte peut toujours être avancé.
- [ ] **TRN-06** `prefers-reduced-motion` (OS) : transitions instantanées, aucune animation gênante.

## 5. Ouverture (correctif #254 — flash et panoramique final)

- [ ] **OPN-01** Au lancement, **pas de flash blanc** avant l'apparition de l'image.
- [ ] **OPN-02** Le **panoramique final** de l'ouverture arrive à la bonne position et au bon moment.
- [ ] **OPN-03** Musique/sons synchronisés avec les images (intro).
- [ ] **OPN-04** Le passage ouverture → titre est fluide (pas de coupure brutale).

## 6. Interface / HUD (correctifs #210/#211/#325/#326)

- [ ] **UI-01** Écran titre : centrage, typographie, fond, animation d'apparition.
- [ ] **UI-02** Menu système (Échap) : panneau, entrées, survols, animation ; **focus clavier visible**
      après Échap (particulièrement sous **Firefox**).
- [ ] **UI-03** Configuration (4 onglets : Affichage, Message, Son, Système) : tout est lisible,
      les contrôles réagissent, les valeurs sont sauvegardées ; **focus visible sur les zones
      défilantes** (Firefox).
- [ ] **UI-04** Sauvegarde/chargement : vignettes, positions, navigation clavier, pas de débordement.
- [ ] **UI-05** Archive / flowchart (déblocage des chapitres) : états corrects, navigation.
- [ ] **UI-06** Écran de confirmation : bouton présélectionné, focus visible, Échap/Entrée corrects.
- [ ] **UI-07** Menu contextuel en jeu (clic droit) et historique : contenu et mise en page.
- [ ] **UI-08** Boutons tactiles : cibles ≥ 44 px, pas de chevauchement avec le texte.

## 7. Mise en page : responsive / portrait / mobile (correctifs #210/#325/#98)

- [ ] **LAY-01** **1280×720** : scène 16:9 entière, pas de bande noire inattendue, texte dans la zone.
- [ ] **LAY-02** **1920×1080** : mise à l'échelle identique (layout logique), pas de flou.
- [ ] **LAY-03** **Portrait** (ex. 390×844) : scène en haut, **zone de texte dédiée sous la scène**,
      texte lisible, pas de scroll horizontal.
- [ ] **LAY-04** Rotation paysage ↔ portrait : le texte et la position de lecture sont **conservés**,
      pas de rechargement.
- [ ] **LAY-05** **Mobile** : tap = avancer ; appui long = menu ; balayage droite = **retour arrière** ;
      balayage haut = historique ; le défilement du texte (dock portrait) fonctionne sans avancer.
- [ ] **LAY-06** Petits écrans : 360×640 (scène entière, texte ≥ 14 px) et 640×360.
- [ ] **LAY-07** Zones système (encoche/barre) : rien n'est masqué (safe-areas).

## 8. Accessibilité (correctifs #211/#326/#257)

- [ ] **A11Y-01** Navigation **Tab** complète sur chaque écran, ordre logique, **anneau de focus
      visible** partout (Chromium + Firefox).
- [ ] **A11Y-02** Après fermeture d'un panneau (Échap), le focus revient à l'élément d'origine.
- [ ] **A11Y-03** Lecteur d'écran (VoiceOver/NVDA si possible) : le texte est annoncé **une fois**,
      pas pendant la frappe ; les boutons ont des noms.
- [ ] **A11Y-04** Zoom navigateur 200 % : pas de contenu coupé (ou défilement acceptable).
- [ ] **A11Y-05** Contraste : textes d'interface lisibles sur leurs fonds (AA).
- [ ] **A11Y-06** `prefers-reduced-motion` : animations d'interface réduites.

## 9. PWA / hors-ligne / perf (correctifs #96/#100/#313)

- [ ] **PWA-01** Installation (icône dans la barre d'adresse) : nom, icône, plein écran corrects.
- [ ] **PWA-02** Après une première visite : couper le réseau, recharger → le jeu démarre (offline).
- [ ] **PWA-03** Mise à jour : nouvelle version détectée/rechargement propre.
- [ ] **PERF-01** Défilement/transitions fluides (pas de saccade), démarrage rapide.
- [ ] **PERF-02** Longue session (plusieurs scènes) : pas de fuite visible (mémoire stable), audio OK.

## 10. Sauvegarde / chargement / audio (correctifs #253/#307/#318)

- [ ] **SAV-01** Sauvegarder puis charger : retour exact (texte, fond, sprites, audio, position).
- [ ] **SAV-02** Sauvegarde **au milieu d'un panoramique** : au chargement, fond à l'état final
      (cohérent avec le jeu d'origine).
- [ ] **SAV-03** Auto-sauvegarde/quick save si accessible : pas de corruption.
- [ ] **AUD-01** BGM boucle correctement, SFX et voix synchrones avec le texte.
- [ ] **AUD-02** Réglages Son (volumes, muet) appliqués immédiatement et persistés.

## 11. Divers

- [ ] **DIV-01** Textes d'interface en **français** cohérents (orthographe, libellés).
- [ ] **DIV-02** Aucun marqueur de développement visible (`TODO`, id technique, trace).
- [ ] **DIV-03** Fermer/rouvrir l'onglet : reprise propre (pas d'écran noir).
- [ ] **DIV-04** Console : aucune erreur pendant toute la session.

## Format de retour

Pour chaque point en échec : `NUMÉRO KO`, ce que tu vois, où (écran/scène) et, si possible, une
courte capture (fichier **hors dépôt**, jamais commité). Les captures et vidéos servent ensuite aux
correctifs et à la validation finale (#315, #316, #254, #213).
