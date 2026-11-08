import { afterEach, describe, expect, it } from "vitest";
import { createMemorySaveStore } from "@/player/save-store.js";
import type { ImportReport } from "@/player/save-transfer.js";
import { setUiLanguage } from "@/ui/i18n.js";
import { describeImportReport, exportFileName, importSaveFile } from "@/ui/save-transfer.js";

const empty: ImportReport = { imported: [], overwritten: [], skippedLocked: [], failed: [], invalid: 0, progressMerged: true };

afterEach(() => setUiLanguage("fr"));

describe("ui/save-transfer", () => {
  it("nomme le fichier d'export avec la date", () => {
    expect(exportFileName(new Date("2026-03-04T10:00:00Z"))).toBe("mahoyo-saves-2026-03-04.json");
  });

  it("décrit un import : importés, verrouillés conservés, invalides, échecs", () => {
    expect(describeImportReport({ ...empty, imported: [1, 2] })).toBe("2 emplacement(s) importé(s).");
    const text = describeImportReport({ ...empty, imported: [1], skippedLocked: [2, 3], invalid: 4, failed: [5] });
    expect(text).toContain("1 emplacement(s) importé(s)");
    expect(text).toContain("2 emplacement(s) verrouillé(s) conservé(s)");
    expect(text).toContain("4 entrée(s) ignorée(s)");
    expect(text).toContain("1 emplacement(s) non écrit(s)");
  });

  it("dit qu'il n'y avait rien à importer", () => {
    expect(describeImportReport(empty)).toBe("Aucune sauvegarde à importer.");
  });

  it("suit la langue de l'interface", () => {
    setUiLanguage("en");
    expect(describeImportReport({ ...empty, skippedLocked: [1] })).toBe("1 locked slot(s) kept unchanged.");
  });

  it("importe un fichier et renvoie le message ; refuse un fichier illisible", async () => {
    const store = createMemorySaveStore();
    const bad = await importSaveFile(new File(["pas du json"], "x.json"), store);
    expect(bad).toEqual({ message: "Fichier de sauvegarde illisible.", report: null });

    const old = await importSaveFile(new File(['{"format":"mahoyo-saves","version":9,"saves":[]}'], "x.json"), store);
    expect(old.message).toBe("Version de fichier de sauvegarde non prise en charge.");

    const ok = await importSaveFile(new File(['{"format":"mahoyo-saves","version":1,"saves":[]}'], "x.json"), store);
    expect(ok.report?.imported).toEqual([]);
  });
});
