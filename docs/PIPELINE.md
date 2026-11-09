# Pipeline d'assets — Documentation

## Vue d'ensemble

Le pipeline convertit les assets du jeu original (PC 2012, KiriKiri/KAG3) en fichiers compatibles web. Il ne **génère ni ne distribue** d'assets sous copyright — l'utilisateur doit fournir ses propres fichiers extraits du jeu.

## Prérequis

| Outil | Rôle | Requis ? |
|---|---|---|
| Node.js ≥ 18 | Exécution du pipeline | ✅ Oui |
| `tsx` (installé via npm) | Exécution des scripts TypeScript | ✅ Oui (devDep) |
| Extracteur XP3 (`xp3extract`, `krkrExtract`, etc.) | Extraction des archives `.xp3` | ⬚ Optionnel |
| Convertisseur TLG externe (`tlg2png`, etc.) | Conversion `.tlg` → `.webp` | ⬚ Optionnel (un décodeur `TLG0.0`/`TLG5` est intégré) |
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

# Conversion TLG → PNG (décodeur intégré) ou WebP (convertisseur externe)
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
- **Sortie** : même arborescence relative
  - **sans convertisseur** : `.png`, par le décodeur intégré `tools/tlg-decode.ts` ;
  - **avec `--tlg-cmd`** (ou l'argument `converterPath`) : `.webp`, par l'outil externe, comme avant. L'outil externe prime toujours sur le décodeur intégré.
- **Décodeur intégré** (écrit pour le projet d'après la spécification publique du format, sans dépendance, PNG via le zlib de Node) :
  - `TLG0.0` (conteneur « sds », `TLG0.0\0sds\x1a` + taille) : l'image interne est décodée, les tags sont ignorés ;
  - `TLG5.0` : bandes de `blockHeight` lignes ; chaque composante (B, G, R, éventuellement A) est compressée en LZSS (fenêtre de 4096 octets, qui se poursuit d'une bande à l'autre) ou stockée brute ; reconstruction par prédicteur vertical puis cumul horizontal, couleurs décorrélées autour du vert ;
  - `TLG6.0` : reconnu mais **non décodé** (Golomb-Rice et prédicteurs, non nécessaire pour les assets utilisés). Le fichier est alors signalé en échec (« TLG6 non pris en charge »), absent du manifest, et les autres fichiers continuent : utiliser `--tlg-cmd` avec un convertisseur externe pour ceux-là ;
  - fichier chiffré ou inconnu : échec avec « signature TLG inconnue ».
- **Corpus de référence** : les 32 `TLG0.0` + `TLG5.0` de l'archive (dont 15 jamais convertis, #155) sont décodés ; pour les 17 qui avaient déjà un PNG, le décodeur le reproduit au pixel près.
- **Réparer une installation existante** (assets déjà générés par l'ancien POC) : `npm run convert-tlg -- <dossier des .tlg restants> <dossier temporaire>`, copier les `.png` manquants dans `assets/image/`, puis ajouter au manifest, pour chacun, `"<nom en minuscules>": { "url": "image/<nom>.png", "source": "fg/<nom>.png", "kind": "image" }`. Sans ajout au manifest, le resolver ne les voit pas.
- Le manifest généré ne prédit plus d'échec : un `.tlg` sans outil externe devient une tâche interne (`convert-image`, sortie `.png`).

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

### 5. Manifest et vérification des références

Le pipeline écrit `asset-manifest.json` (clé de storage normalisée → URL web), puis
vérifie les références des scripts dans `<work>/report.json` :

- `missingStorages` : clé de base absente du manifest (image ou son) ;
- `emptyStorageRefs` : références `storage` vides (calques sans image), comptées à part ;
- `macroStorageRefs` : paramètres de macro `%…`, non résolubles statiquement (le
  runtime les résout à l'exécution).

La vérification résout comme le player (`src/core/asset-resolver.ts`) : le parser a
déjà normalisé chaque `storage` avec `storageKey` — suffixe de variante `|x`, dossier,
extension, casse et espaces retirés — puis la clé est cherchée dans le manifest, avec
un repli NFKC (casse, espaces de bordure) pour les clés d'anciens manifests (par
exemple un espace resté avant l'extension). Une référence à variante (`nom|x`) ou une
clé à espace final n'est donc pas signalée à tort. Le manifest **généré** n'écrit que
des clés normalisées (`storageKey` dans `tools/inventory.ts`) : le repli ne sert
qu'aux installations antérieures, sans régénération obligatoire. `--strict` échoue
s'il reste des `missingStorages`.

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

> ℹ️ `data/scenario/` de l'archive 2012 contient, à côté des scripts `.ks`, des
> plugins `.tjs`, des scripts système chiffrés `.ttd`, des timelines `.tla` et des
> médias (`.tlg`, `.wav`) utilisés par les plugins moteur. L'inventaire ne classe
> en scénario que les `.ks` ; les médias suivent leur extension (image/son) et les
> fichiers moteur sont ignorés. Avant cette règle, tous étaient transcodés en
> `.ks` illisibles (issue #111).
>
> ⚠️ `public/assets` (dossier **ou** lien symbolique) est ignoré par git grâce à la règle `.gitignore` `public/assets`, **sans barre finale** : une règle avec barre finale (`public/assets/`) ne s'applique pas à un lien symbolique.
>
> - Un lien symbolique local vers les assets du jeu est autorisé pour le développement : il reste non suivi (donc ignoré).
> - **Ne pas lancer `npm run build` tant qu'un tel lien existe** : Vite copie le contenu du dossier lié (plusieurs Go) dans `dist/`.
> - `npm run check:assets` échoue si un lien symbolique `public/assets` a été **suivi** (commité) par git, avec un message actionnable. La correction est `git rm --cached public/assets` (le lien local reste en place).

### Contrôle anti-assets (`npm run check:assets`)

`npm run check:assets` liste les entrées suivies par git (`git ls-files -s`) et applique quatre contrôles :

- **extension d'asset hors allowlist** (`.tlg`, `.xp3`, `.ks`, `.png`, `.ogg`, polices…) ;
- **empreinte SHA-256** des placeholders : un fichier autorisé dont le contenu ne correspond plus à son empreinte est signalé, car un vrai asset peut remplacer un placeholder au même chemin ;
- **gros binaires** (plus de 256 Kio, détectés par la présence d'un octet NUL) hors allowlist, quelle que soit leur extension ;
- **lien symbolique `public/assets` suivi** par git (voir la note ⚠️ ci-dessus).

Les placeholders autorisés et leurs empreintes sont dans `tools/allowed-assets.txt` ; après ajout ou modification d'un placeholder, mettre à jour les empreintes avec `npm run check:assets -- --update`, puis relire le diff.

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
Le décodeur TLG est testé dans `tests/unit/tools/tlg-decode.test.ts` sur des `TLG5` **inventés** par un encodeur écrit dans le test (LZSS, RGB/RGBA, bandes partielles, composantes brutes, conteneur `TLG0.0`, TLG6/fichiers tronqués, PNG) : aucun asset du jeu n'est versionné.
L'outil d'audit headless est testé dans `tests/unit/tools/audit-scenario.test.ts` (21 tests, dont 11 pour la détection de scripts chiffrés).
Le contrôle anti-assets est testé dans `tests/unit/tools/check-no-assets.test.ts` et `tests/unit/tools/check-assets-symlink.test.ts` (lien symbolique `public/assets` ignoré par git ; lien suivi par git détecté).
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
