# Progression du projet

Barre de progression globale (mise à jour manuelle).

```
[████████░░░░░░░░░░░░░] ~58 %
```

## Détail par épic

| Épic | Description | Progression | État |
|---|---|---|---|
| E0 — Gouvernance & socle | Repo, docs, CI, conventions | 95 % | 🟢 Avancé |
| E1 — Extraction | `.xp3`, `.tlg`, scripts `.ks` | 60 % | 🟡 En cours (pipeline TS, wrappers OK, extracteurs externes requis) |
| E2 — Parser KAG3 | Lexer, parser, types | 98 % | 🟢 Avancé (inline tags [chgfg]/[fg]/[se]/[wait] routés via parseCommand) |
| E3 — Runtime & rendu web | Runtime, renderer, player | 98 % | 🟢 Avancé (prologue jouable en UI/jsdom, evalGlobal/timeline_object gérés) |
| E4 — Pipeline d'assets | Conversion WebP/OGG, normalisation `.ks`, manifest, encodage, enchaînement | 100 % | 🟢 Terminé (pipeline génère 5.8 Go d'assets, manifest OK) |
| E5 — UI/UX | Thème, accessibilité, PWA | 50 % | 🟡 En cours |
| E6 — QA & optimisation | Tests, perfs, mobile, audit headless | 75 % | 🟡 En cours (audit corpus complet : 234 scripts, 0 erreur, <1s) |
| E7 — Projet réel | Architecture propre, refactor | 95 % | 🟢 Avancé (agents A/B/C/D mergés) |

## Légende

- 🟢 Avancé : principaux éléments en place.
- 🟡 En cours : travail actif.
- ⚪ Non commencé : à planifier.
