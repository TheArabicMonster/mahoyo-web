/**
 * Sauvegarde/restauration des fichiers d'assets écrasés par les placeholders e2e (#417).
 *
 * Isolation par défaut : les placeholders vont dans `<tmp>/mahoyo-e2e-assets`, jamais dans
 * `public/assets`. Si un dossier personnalisé (`MAHOYO_E2E_ASSETS`) ou `--force` est utilisé,
 * ce module sauvegarde les fichiers listés avant écriture et permet une restauration :
 * - immédiate si l'installation échoue (ou sur SIGINT/SIGTERM pendant la génération) ;
 * - après les tests, via le marqueur `.e2e-assets-backup.json` lu par le `globalTeardown`
 *   Playwright (donc aussi quand des tests échouent).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

export const E2E_ASSETS_BACKUP_MARKER = ".e2e-assets-backup.json";

export type AssetsBackup = {
  /** Dossier temporaire contenant la copie des fichiers existants. */
  backupDir: string;
  files: readonly string[];
  /** Restaure les fichiers sauvegardés et supprime ceux créés par l'installation. */
  restore: () => void;
  /** Supprime la sauvegarde (installation conservée). */
  dispose: () => void;
};

export type AssetsBackupMarker = {
  kind: "mahoyo-e2e-assets-backup";
  version: 1;
  backupDir: string;
  files: readonly string[];
  createdAt: string;
};

/** Sauvegarde les fichiers existants de `publicDir` (chemins relatifs listés). */
export function backupAssets(publicDir: string, files: readonly string[]): AssetsBackup {
  const backupDir = mkdtempSync(join(tmpdir(), "mahoyo-e2e-assets-backup-"));
  const saved = new Set<string>();
  for (const relative of files) {
    const source = join(publicDir, relative);
    if (!existsSync(source)) continue;
    const target = join(backupDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    saved.add(relative);
  }
  const restore = (): void => {
    for (const relative of files) {
      const source = join(publicDir, relative);
      if (saved.has(relative)) {
        const target = join(publicDir, relative);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(backupDir, relative), target);
      } else if (existsSync(source)) {
        // Fichier créé par l'installation : on le retire pour retrouver l'état d'origine.
        unlinkSync(source);
      }
    }
  };
  return {
    backupDir,
    files,
    restore,
    dispose: () => rmSync(backupDir, { recursive: true, force: true }),
  };
}

export function writeBackupMarker(publicDir: string, backup: AssetsBackup): void {
  const marker: AssetsBackupMarker = {
    kind: "mahoyo-e2e-assets-backup",
    version: 1,
    backupDir: backup.backupDir,
    files: backup.files,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(publicDir, E2E_ASSETS_BACKUP_MARKER), JSON.stringify(marker, null, 2), "utf-8");
}

export function readBackupMarker(publicDir: string): AssetsBackupMarker | null {
  const path = join(publicDir, E2E_ASSETS_BACKUP_MARKER);
  if (!existsSync(path)) return null;
  try {
    const marker = JSON.parse(readFileSync(path, "utf-8")) as AssetsBackupMarker;
    if (marker.kind !== "mahoyo-e2e-assets-backup" || typeof marker.backupDir !== "string") return null;
    return marker;
  } catch {
    return null;
  }
}

/**
 * Restaure depuis le marqueur (appelé après les tests par `globalTeardown`) : copies puis
 * suppression du marqueur et du dossier de sauvegarde. Retourne true si une restauration a eu lieu.
 */
export function restoreFromMarker(publicDir: string): boolean {
  const marker = readBackupMarker(publicDir);
  if (!marker) return false;
  try {
    const backup: AssetsBackup = {
      backupDir: marker.backupDir,
      files: marker.files,
      restore: () => {
        for (const relative of marker.files) {
          const source = join(marker.backupDir, relative);
          const target = join(publicDir, relative);
          if (existsSync(source)) {
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(source, target);
          } else if (existsSync(target)) {
            unlinkSync(target);
          }
        }
      },
      dispose: () => rmSync(marker.backupDir, { recursive: true, force: true }),
    };
    backup.restore();
    unlinkSync(join(publicDir, E2E_ASSETS_BACKUP_MARKER));
    return true;
  } finally {
    rmSync(marker.backupDir, { recursive: true, force: true });
  }
}
