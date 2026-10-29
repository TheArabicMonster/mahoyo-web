# Pipeline d'assets — Documentation

## Vue d'ensemble

Le pipeline convertit les assets du jeu original (PC 2012, KiriKiri/KAG3) en fichiers compatibles web. Il ne **génère ni ne distribue** d'assets sous copyright — l'utilisateur doit fournir ses propres fichiers extraits du jeu.

## Prérequis

| Outil | Rôle | Requis ? |
|---|---|---|
| Node.js ≥ 18 | Exécution du pipeline | ✅ Oui |
| `tsx` (installé via npm) | Exécution des scripts TypeScript | ✅ Oui (devDep) |
| Extracteur XP3 (`xp3extract`, `krkrExtract`, etc.) | Extraction des archives `.xp3` | ⬚ Optionnel |
| Convertisseur TLG (`tlg2png`, etc.) | Conversion `.tlg` → `.webp`/`.png` | ⬚ Optionnel |
| `ffmpeg` (ou autre encodeur) | Re-encodage audio | ⬚ Optionnel |

> Les outils optionnels sont des **wrappers** : le pipeline les appelle s'ils sont fournis, sinon il ignore l'étape correspondante avec un avertissement.

## Utilisation

### Pipeline complet

```bash
npm run pipeline -- \
  --input <dossier_jeu> \
  --output <dossier_web> \
  [--dry-run] \
  [--xp3-extractor <chemin>] \
  [--tlg-converter <chemin>] \
  [--audio-encoder <chemin>]
```

**Exemple :**

```bash
npm run pipeline -- \
  --input ./raw-assets \
  --output ./public/assets \
  --xp3-extractor /usr/local/bin/xp3extract \
  --tlg-converter /usr/local/bin/tlg2png
```

### Mode dry-run

Passe `--dry-run` pour simuler le pipeline sans écrire aucun fichier. Utile pour vérifier quels fichiers seraient traités.

### Étapes individuelles

Chaque étape peut être lancée seule :

```bash
# Extraction XP3
npm run extract-xp3 -- <inputDir> <outputDir> [extractorPath]

# Conversion TLG → WebP
npm run convert-tlg -- <inputDir> <outputDir> [converterPath]

# Conversion/copie audio
npm run convert-audio -- <inputDir> <outputDir> [encoderPath]

# Normalisation des scripts KAG
npm run normalize-ks -- <input.ks>
```

## Étapes du pipeline

### 1. extract-xp3

- **Entrée** : fichiers `.xp3` dans le dossier d'input
- **Sortie** : contenu extrait dans le dossier d'output (sous-dossier par archive)
- **Sans extracteur** : liste les archives trouvées et passe

### 2. convert-tlg

- **Entrée** : fichiers `.tlg` (images KiriKiri)
- **Sortie** : fichiers `.webp` dans la même arborescence relative
- **Sans convertisseur** : liste les TLG trouvés et passe

### 3. convert-audio

- **Entrée** : fichiers `.ogg`, `.mp3`, `.wav`
- **Sortie** : fichiers `.ogg` dans la même arborescence relative
- **Sans encodeur** : copie simple des fichiers OGG (déjà compatibles navigateur)
- **Avec encodeur** : re-encodage via l'outil fourni (ex: ffmpeg)

### 4. normalize-ks

- **Entrée** : fichiers `.ks` (scripts KAG en Shift_JIS)
- **Sortie** : fichiers `.ks` en UTF-8, normalisés
- **Transformations** :
  1. Détection d'encodage (Shift_JIS par défaut) → décodage en UTF-8
  2. Suppression du BOM
  3. Normalisation des fins de ligne (CRLF/CR → LF)
  4. Suppression des commandes non supportées (`@eval`, `@iscript`, `@endscript`) — remplacées par des lignes vides pour préserver les numéros de ligne
  5. Normalisation des attributs `storage=` : suppression des extensions d'image/audio, conversion en minuscules, remplacement des séparateurs de chemin par des `_`

  Exemple de transformation :
  ```
  # Avant
  @bg storage=bg/night.tlg
  [playbgm storage=bgm/rain.ogg]

  # Après
  @bg storage=bg_night
  [playbgm storage=bgm_rain]
  ```

## Structure des dossiers

```
input/            ← Dossier fourni par l'utilisateur (assets du jeu)
├── data.xp3      ← Archives KiriKiri
└── ...

output/           ← Généré par le pipeline
├── bg/           ← Images de fond (WebP)
├── bgm/          ← Musique (OGG)
├── se/           ← Effets sonores (OGG)
├── scenario/     ← Scripts KAG normalisés (UTF-8)
└── ...
```

> ⚠️ Le dossier `public/assets/` est dans `.gitignore` pour éviter de commiter des assets sous copyright.

## Architecture technique

Chaque outil (`tools/*.ts`) exporte :
- Des **fonctions pures** testables unitairement (sans I/O)
- Une **fonction `run*(context: PipelineContext)`** pour l'intégration dans le pipeline
- Un **point d'entrée CLI** en bas de fichier (via `import.meta.url`)

Le `PipelineContext` partagé (`tools/pipeline-utils.ts`) contient :
```typescript
type PipelineContext = {
  inputDir: string;       // Dossier source
  outputDir: string;      // Dossier cible
  dryRun: boolean;        // Mode simulation
  xp3Extractor?: string;  // Chemin vers l'extracteur XP3
  tlgConverter?: string;  // Chemin vers le convertisseur TLG
  audioEncoder?: string;  // Chemin vers l'encodeur audio
};
```

## Tests

Les fonctions pures de normalisation sont testées dans `tests/unit/tools/normalize-ks.test.ts` (17 tests).
L'outil d'audit headless est testé dans `tests/unit/tools/audit-scenario.test.ts` (21 tests, dont 11 pour la détection de scripts chiffrés).
Le parser KAG est testé dans `tests/unit/kag/parser.test.ts` (27 tests, dont 5 pour les inline tags).

```bash
npm test           # Lance tous les tests (388 au total)
npm run audit      # Audit headless du corpus KAG complet
```

## Audit headless

L'outil `tools/audit-scenario.ts` parcourt tous les scripts `.ks` narratifs
via le moteur KAG et produit un rapport JSON + Markdown dans `reports/`.

- Les scripts système (menus, config, plugins, teatime, tracerplugin) sont ignorés.
- Les scripts chiffrés/binaires sont détectés automatiquement (`isEncrypted()`) :
  signatures magiques (PNG, RIFF), caractères de contrôle et katakana demi-chasse.
  Ils sont exclus du cache de scripts pour empêcher le chargement via `@call`/`@jump`.
- Chaque script est exécuté jusqu'à `@end` ou 10 000 steps maximum.
- Les commandes inconnues, warnings et assets manquants sont collectés et agrégés.
- Les rapports sont dans `.gitignore` (ils citent des noms d'assets du jeu).

```bash
npm run audit      # Génère reports/scenario-audit.json et .md
```
