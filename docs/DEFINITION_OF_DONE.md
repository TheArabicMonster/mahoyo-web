# Définition of Done

Check-lists à satisfaire avant de déclarer un travail "terminé".

## DoD — Issue

- [ ] Les critères d'acceptation de l'issue sont tous remplis.
- [ ] Le code compile / les tests passent (le cas échéant).
- [ ] Aucun asset sous copyright n'a été ajouté au dépôt (`npm run check:assets` doit rester vert).
- [ ] La documentation impactée est à jour.
- [ ] L'issue est rattachée au bon épic et à la bonne priorité.

## DoD — Pull Request

- [ ] La PR référence une issue (fermeture automatique si pertinent).
- [ ] Les changements sont couverts par des tests ou une démo reproductible.
- [ ] Le style suit les conventions (voir `AGENTS.md`).
- [ ] La checklist du template de PR est cochée.
- [ ] Revue effectuée par au moins un humain ou un agent (contexte partagé).

## DoD — Release / milestone

- [ ] Toutes les issues de la milestone sont fermées.
- [ ] Le `README.md` reflète l'état du projet.
- [ ] La `docs/ROADMAP.md` est à jour (épic suivant marqué "en cours").
- [ ] Aucune régression connue non documentée.

## DoD — v1.0

La v1.0 est atteinte quand **toutes** les cases ci-dessous sont cochées. Chaque critère est vérifiable par un test, un script ou une commande ; la preuve attendue est indiquée entre parenthèses.

### Complétude

- [ ] Une lecture automatisée traverse les **221 scripts narratifs** (251 fichiers - 17 système - 13 binaires), du prologue à la dernière scène, sans blocage ni erreur (test d'intégration de lecture complète : 221/221 scripts lus, 0 exception, 0 boucle sans progression). Voir [`docs/LECTURE_COMPLETE.md`](docs/LECTURE_COMPLETE.md) pour l'usage.
- [ ] Ce test utilise les **vrais assets locaux** (non commités), dont le chemin est fourni par la variable d'environnement `MAHOYO_ASSETS_DIR` (aucun chemin absolu en dur ; le test est ignoré avec un message explicite si la variable est absente).
- [ ] La CI exécute la même logique de lecture avec des **placeholders originaux** (aucun asset sous copyright) et reste verte.

### Commandes KAG

- [ ] `npm run audit` ne signale **plus aucune commande inconnue ayant un effet visible** (sortie de la commande : 0 commande inconnue à effet visible).
- [ ] Les commandes **volontairement ignorées** (no-op) sont documentées dans le dépôt, avec la raison, et l'audit les distingue des commandes inconnues.

### Navigation

- [ ] **Enchaînement automatique des chapitres** : à la fin d'un script, le suivant démarre sans intervention (couvert par le test de lecture complète).
- [ ] **Menu de choix de chapitre** : accessible depuis l'interface, lance le chapitre sélectionné (test e2e).

### Persistance

- [ ] **Sauvegarde** et **chargement** restituent exactement l'état (script, position, variables, fond, sprites, audio) (tests unitaires + e2e aller-retour).
- [ ] **Retour arrière** (backlog / rollback) fonctionnel (test).
- [ ] **Saut du texte déjà lu** fonctionnel, la lecture déjà vue étant mémorisée entre les sessions (test).

### Pipeline

- [ ] Un utilisateur qui possède le jeu obtient un **résultat jouable en suivant uniquement le `README.md`** (relecture à froid de la procédure par une personne tierce, ou exécution scriptée de la procédure documentée, jusqu'au lancement du player).

### Légal

- [ ] **Aucun asset** sous copyright n'est présent dans le dépôt (images, sons, scripts `.ks`, polices, archives `.xp3`).
- [ ] Un **contrôle automatique en CI** échoue si un tel fichier est ajouté (job CI dédié, vérifié par une PR de test qui échoue volontairement).

### Qualité

- [ ] **0 régression connue non documentée** (liste des issues ouvertes de type `bug` relue ; chaque régression restante est documentée).
- [ ] `npm test`, `npm run lint` et `npm run build` passent en CI.
- [ ] Au moins **un test e2e** (`npm run test:e2e`) couvre un **parcours complet** (démarrage, lecture, choix, sauvegarde/chargement).

### Plateforme

- [ ] Fonctionne sur **Chrome et Firefox récents**, en **desktop** (e2e Playwright exécuté sur les deux navigateurs).
