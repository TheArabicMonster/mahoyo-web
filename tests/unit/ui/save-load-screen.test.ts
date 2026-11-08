import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELOAD_AFTER_IMPORT_MS } from "@/ui/save-load-screen.js";
import { setUiLanguage } from "@/ui/i18n.js";
import { createSaveLoadScreen, type SaveLoadDeps, type SaveLoadMode, type SaveLoadScreen } from "@/ui/save-load-screen.js";
import type { SaveSlot } from "@/ui/types.js";

const TS = new Date(2025, 2, 9, 14, 5, 7).getTime();
const full = (id: SaveSlot["id"], extra: Partial<NonNullable<SaveSlot["data"]>> = {}): SaveSlot => ({
  id,
  data: {
    scriptFile: "a.ks",
    timestamp: TS,
    previewText: "texte",
    thumbnailUrl: null,
    stage: {} as never,
    sceneTitle: "Scène locale",
    comment: "",
    locked: false,
    ...extra,
  },
});

function setup(mode: SaveLoadMode, slots: SaveSlot[], confirmAnswer = true, extra: Partial<SaveLoadDeps> = {}) {
  const commands = {
    save: vi.fn(() => Promise.resolve()),
    load: vi.fn(() => Promise.resolve()),
    deleteSave: vi.fn(() => Promise.resolve()),
    updateSave: vi.fn(() => Promise.resolve()),
    closeScreen: vi.fn(),
  };
  const confirm = vi.fn((_message: string, _options?: { defaultButton?: "yes" | "no" }) => Promise.resolve(confirmAnswer));
  const toast = vi.fn();
  const state = { enabled: true };
  const screen: SaveLoadScreen = createSaveLoadScreen({ mode, commands, confirm, toast, isInputEnabled: () => state.enabled, ...extra });
  document.body.appendChild(screen.element);
  screen.setSlots(slots);
  const q = (sel: string) => screen.element.querySelector<HTMLElement>(sel);
  const qa = (sel: string) => [...screen.element.querySelectorAll<HTMLElement>(sel)];
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  return { screen, commands, confirm, toast, state, q, qa, key };
}

describe("SaveLoadScreen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setUiLanguage("fr");
  });
  afterEach(() => setUiLanguage("fr"));

  describe("grille et pagination", () => {
    it("affiche 8 fiches <article> par page, auto et rapide en tête de la page 1", () => {
      const { qa } = setup("load", []);
      const cards = qa("article.mh-sl-card");
      expect(cards).toHaveLength(8);
      expect(cards.map((c) => c.dataset.slot)).toEqual(["auto", "quick", "1", "2", "3", "4", "5", "6"]);
      expect(cards[0]!.classList.contains("mh-sl-card--special")).toBe(true);
      expect(cards[2]!.classList.contains("mh-sl-card--special")).toBe(false);
    });

    it("propose 15 pages, la page active porte aria-current et la navigation change les fiches", () => {
      const { screen, q, qa } = setup("load", []);
      const pages = qa(".mh-sl-page");
      expect(pages).toHaveLength(15);
      expect(pages.filter((p) => p.getAttribute("aria-current") === "page").map((p) => p.textContent)).toEqual(["1"]);
      pages[2]!.click();
      expect(screen.currentPage).toBe(3);
      expect(qa("article.mh-sl-card").map((c) => c.dataset.slot)).toEqual(["15", "16", "17", "18", "19", "20", "21", "22"]);
      expect(qa(".mh-sl-page").filter((p) => p.getAttribute("aria-current") === "page").map((p) => p.textContent)).toEqual(["3"]);
      expect(q(".mh-sl-sr")!.textContent).toBe("Page 3 sur 15");
      expect(q(".mh-sl-page[aria-current='page']")!.getAttribute("aria-label")).toBe("Page 3");
    });

    it("la dernière page se termine par l'emplacement 118", () => {
      const { screen, qa } = setup("save", []);
      screen.goToPage(15);
      expect(qa("article.mh-sl-card").at(-1)!.dataset.slot).toBe("118");
    });

    it("PageDown / PageUp tournent les pages sans dépasser les bornes", () => {
      const { screen, qa, key } = setup("load", []);
      key(qa("article")[0]!, "PageUp");
      expect(screen.currentPage).toBe(1);
      key(qa("article")[0]!, "PageDown");
      key(qa("article")[0]!, "PageDown");
      expect(screen.currentPage).toBe(3);
      key(qa("article")[0]!, "PageUp");
      expect(screen.currentPage).toBe(2);
      screen.goToPage(15);
      key(qa("article")[0]!, "PageDown");
      expect(screen.currentPage).toBe(15);
    });

    it("flèches gauche/droite sur le sélecteur : page suivante et focus conservé sur le chiffre", () => {
      const { screen, qa, key } = setup("load", []);
      const first = qa(".mh-sl-page")[0]!;
      first.focus();
      key(first, "ArrowRight");
      expect(screen.currentPage).toBe(2);
      expect(document.activeElement).toBe(qa(".mh-sl-page")[1]);
      key(document.activeElement!, "ArrowLeft");
      expect(screen.currentPage).toBe(1);
      expect(document.activeElement).toBe(qa(".mh-sl-page")[0]);
    });
  });

  describe("fiche d'emplacement", () => {
    it("fiche pleine : titre de scène, date AAAA/MM/JJ hh:mm:ss, commentaire, case Verr., boutons nommés", () => {
      const { q } = setup("load", [full(1, { comment: "mon note" })]);
      const card = q("[data-slot='1']")!;
      expect(card.tagName).toBe("ARTICLE");
      expect(card.getAttribute("aria-label")).toBe("Slot 1 : Scène locale, 2025/03/09 14:05:07");
      expect(card.querySelector(".mh-sl-scene")!.textContent).toBe("Scène locale");
      expect(card.querySelector("time")!.textContent).toBe("2025/03/09 14:05:07");
      expect((card.querySelector(".mh-sl-comment") as HTMLInputElement).value).toBe("mon note");
      expect(card.querySelector(".mh-sl-lock")!.textContent).toContain("Verr.");
      expect(card.querySelector(".mh-sl-delete")!.getAttribute("aria-label")).toBe("Supprimer : Slot 1");
      expect(card.querySelector(".mh-sl-load")!.getAttribute("aria-label")).toBe("Charger : Slot 1");
    });

    it("sans titre de scène, retombe sur le nom du fichier", () => {
      const { q } = setup("load", [full(1, { sceneTitle: undefined })]);
      expect(q("[data-slot='1'] .mh-sl-scene")!.textContent).toBe("a.ks");
    });

    it("emplacement vide en chargement : cadre sans contenu ni bouton", () => {
      const { q } = setup("load", []);
      const card = q("[data-slot='3']")!;
      expect(card.classList.contains("mh-sl-card--empty")).toBe(true);
      expect(card.querySelector("button, input, img, time")).toBeNull();
      expect(card.textContent).toBe("");
      expect(card.getAttribute("aria-label")).toBe("Slot 3 : vide");
    });

    it("emplacement spécial vide : seule la marque est visible", () => {
      const { q } = setup("load", []);
      expect(q("[data-slot='auto']")!.textContent).toBe("Auto");
      expect(q("[data-slot='quick'] .mh-sl-badge")!.textContent).toBe("Rapide");
    });

    it("emplacement vide en sauvegarde : un bouton Sauvegarder", () => {
      const { q, commands } = setup("save", []);
      const btn = q("[data-slot='3'] .mh-sl-save")!;
      expect(btn.textContent).toBe("Sauvegarder");
      btn.click();
      expect(commands.save).toHaveBeenCalledWith(3);
    });

    it("les libellés suivent la langue", () => {
      setUiLanguage("en");
      const { q } = setup("load", [full(1)]);
      expect(q(".mh-sl-title")!.textContent).toBe("Load");
      expect(q("[data-slot='1'] .mh-sl-load")!.textContent).toBe("Load");
      expect(q(".mh-sl-back")!.textContent).toBe("Back");
      expect(q(".mh-sl-subtitle")!.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("actions", () => {
    it("charger : confirmation avec Oui présélectionné, puis commande", async () => {
      const { q, confirm, commands } = setup("load", [full(1)]);
      q("[data-slot='1'] .mh-sl-load")!.click();
      await vi.waitFor(() => expect(commands.load).toHaveBeenCalledWith(1));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0]![0]).toBe("Charger « Slot 1 » ?");
      expect(confirm.mock.calls[0]![1]).toEqual({ defaultButton: "yes" });
    });

    it("charger : refus de la confirmation, rien n'est chargé", async () => {
      const { q, confirm, commands } = setup("load", [full(1)], false);
      q("[data-slot='1'] .mh-sl-load")!.click();
      await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
      await Promise.resolve();
      expect(commands.load).not.toHaveBeenCalled();
    });

    it("supprimer : commande directe (le player demande la confirmation, Non par défaut)", () => {
      const { q, commands, confirm } = setup("load", [full(2)]);
      q("[data-slot='2'] .mh-sl-delete")!.click();
      expect(commands.deleteSave).toHaveBeenCalledWith(2);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("sauvegarder sur un emplacement plein : commande directe (confirmation du player)", () => {
      const { q, commands } = setup("save", [full(2)]);
      q("[data-slot='2'] .mh-sl-save")!.click();
      expect(commands.save).toHaveBeenCalledWith(2);
    });

    it("emplacement verrouillé : Supprimer désactivé, Sauvegarder refusé avec un message", () => {
      const { q, commands, toast } = setup("save", [full(2, { locked: true })]);
      const del = q("[data-slot='2'] .mh-sl-delete") as HTMLButtonElement;
      expect(del.disabled).toBe(true);
      const save = q("[data-slot='2'] .mh-sl-save")!;
      expect(save.getAttribute("aria-disabled")).toBe("true");
      del.click();
      save.click();
      expect(commands.deleteSave).not.toHaveBeenCalled();
      expect(commands.save).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith("Cet emplacement est verrouillé : sauvegarde impossible.");
    });

    it("emplacement verrouillé : Charger reste possible", async () => {
      const { q, commands } = setup("load", [full(2, { locked: true })]);
      q("[data-slot='2'] .mh-sl-load")!.click();
      await vi.waitFor(() => expect(commands.load).toHaveBeenCalledWith(2));
    });

    it("la case Verr. envoie le verrou et désactive Supprimer aussitôt", () => {
      const { q, commands } = setup("load", [full(2)]);
      const box = q("[data-slot='2'] .mh-sl-lock input") as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      expect(commands.updateSave).toHaveBeenCalledWith(2, { locked: true });
      expect((q("[data-slot='2'] .mh-sl-delete") as HTMLButtonElement).disabled).toBe(true);
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      expect(commands.updateSave).toHaveBeenLastCalledWith(2, { locked: false });
      expect((q("[data-slot='2'] .mh-sl-delete") as HTMLButtonElement).disabled).toBe(false);
    });

    it("le commentaire est envoyé à la validation, nettoyé et limité", () => {
      const { q, commands } = setup("load", [full(2)]);
      const input = q("[data-slot='2'] .mh-sl-comment") as HTMLInputElement;
      input.value = "  à relire  ";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(commands.updateSave).toHaveBeenCalledWith(2, { comment: "à relire" });
      expect(input.maxLength).toBe(60);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(commands.updateSave).toHaveBeenCalledTimes(1);
    });

    it("pendant un chargement (entrées bloquées), les boutons n'agissent plus", () => {
      const { q, commands, state } = setup("save", [full(2)]);
      state.enabled = false;
      q("[data-slot='2'] .mh-sl-save")!.click();
      q("[data-slot='2'] .mh-sl-delete")!.click();
      q(".mh-sl-back")!.click();
      expect(commands.save).not.toHaveBeenCalled();
      expect(commands.deleteSave).not.toHaveBeenCalled();
      expect(commands.closeScreen).not.toHaveBeenCalled();
    });

    it("Retour ferme l'écran", () => {
      const { q, commands } = setup("load", []);
      q(".mh-sl-back")!.click();
      expect(commands.closeScreen).toHaveBeenCalled();
    });
  });

  describe("clavier", () => {
    it("une seule fiche est dans l'ordre de tabulation (curseur itinérant)", () => {
      const { qa } = setup("load", []);
      expect(qa("article").map((c) => c.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);
    });

    it("les flèches déplacent le focus dans la grille 2 × 4", () => {
      const { qa, key } = setup("load", []);
      const cards = () => qa("article");
      cards()[0]!.focus();
      key(document.activeElement!, "ArrowRight");
      expect(document.activeElement).toBe(cards()[1]);
      key(document.activeElement!, "ArrowDown");
      expect(document.activeElement).toBe(cards()[3]);
      key(document.activeElement!, "ArrowLeft");
      expect(document.activeElement).toBe(cards()[2]);
      key(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(cards()[0]);
      key(document.activeElement!, "ArrowUp");
      expect(document.activeElement).toBe(cards()[0]);
      expect(cards().map((c) => c.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);
    });

    it("Entrée sur une fiche pleine la charge (après confirmation)", async () => {
      const { qa, key, commands, confirm } = setup("load", [full("quick")]);
      const card = qa("article")[1]!;
      card.focus();
      key(card, "Enter");
      await vi.waitFor(() => expect(commands.load).toHaveBeenCalledWith("quick"));
      expect(confirm).toHaveBeenCalledTimes(1);
    });

    it("Entrée sur une fiche vide en chargement ne fait rien ; en sauvegarde elle sauvegarde", async () => {
      const load = setup("load", []);
      const c1 = load.qa("article")[2]!;
      c1.focus();
      load.key(c1, "Enter");
      await Promise.resolve();
      expect(load.commands.load).not.toHaveBeenCalled();
      expect(load.confirm).not.toHaveBeenCalled();
      const save = setup("save", []);
      const c2 = save.qa("article")[2]!;
      c2.focus();
      save.key(c2, "Enter");
      await vi.waitFor(() => expect(save.commands.save).toHaveBeenCalledWith(1));
    });

    it("Échap dans le commentaire annule la saisie sans se propager (l'écran reste ouvert)", () => {
      const { q, key, commands } = setup("load", [full(2, { comment: "ok" })]);
      const onDoc = vi.fn();
      document.addEventListener("keydown", onDoc);
      const input = q("[data-slot='2'] .mh-sl-comment") as HTMLInputElement;
      input.focus();
      input.value = "brouillon";
      key(input, "Escape");
      document.removeEventListener("keydown", onDoc);
      expect(input.value).toBe("ok");
      expect(onDoc).not.toHaveBeenCalled();
      expect(commands.updateSave).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(q("[data-slot='2']"));
    });

    it("les flèches ne sont pas détournées dans le champ de commentaire", () => {
      const { q, key } = setup("load", [full(2)]);
      const input = q("[data-slot='2'] .mh-sl-comment")!;
      input.focus();
      key(input, "ArrowRight");
      expect(document.activeElement).toBe(input);
    });
  });

  describe("export et import JSON", () => {
    it("sans actions de transfert, aucun bouton", () => {
      const { q } = setup("load", []);
      expect(q(".mh-sl-export")).toBeNull();
      expect(q(".mh-sl-import")).toBeNull();
    });

    it("Exporter télécharge et affiche le message", async () => {
      const transfer = { export: vi.fn(() => Promise.resolve("2 emplacement(s) exporté(s).")), import: vi.fn() };
      const { q, toast } = setup("load", [], true, { transfer });
      expect(q(".mh-sl-export")!.textContent).toBe("Exporter");
      q(".mh-sl-export")!.click();
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("2 emplacement(s) exporté(s)."));
    });

    it("Importer : message puis rechargement de la page seulement si des emplacements ont été écrits", async () => {
      vi.useFakeTimers();
      try {
        const reload = vi.fn();
        const transfer = {
          export: vi.fn(),
          import: vi.fn().mockResolvedValueOnce({ message: "ok", imported: true }).mockResolvedValueOnce({ message: "rien", imported: false }).mockResolvedValueOnce(null),
        };
        const { q, toast } = setup("save", [], true, { transfer, reload });
        q(".mh-sl-import")!.click();
        await vi.advanceTimersByTimeAsync(0);
        expect(toast).toHaveBeenLastCalledWith("ok");
        expect(reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(RELOAD_AFTER_IMPORT_MS);
        expect(reload).toHaveBeenCalledTimes(1);
        q(".mh-sl-import")!.click();
        await vi.advanceTimersByTimeAsync(RELOAD_AFTER_IMPORT_MS + 10);
        expect(toast).toHaveBeenLastCalledWith("rien");
        q(".mh-sl-import")!.click();
        await vi.advanceTimersByTimeAsync(RELOAD_AFTER_IMPORT_MS + 10);
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("un échec du transfert affiche un message d'erreur", async () => {
      const transfer = { export: vi.fn(() => Promise.reject(new Error("x"))), import: vi.fn() };
      const { q, toast } = setup("load", [], true, { transfer });
      q(".mh-sl-export")!.click();
      await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Échec de la sauvegarde."));
    });
  });

  describe("rafraîchissement (setSlots)", () => {
    it("conserve la page et ne reconstruit pas les fiches inchangées", () => {
      const { screen, qa } = setup("load", [full(1)]);
      const before = qa("article")[2]!;
      screen.setSlots([full(1)]);
      expect(qa("article")[2]).toBe(before);
      screen.goToPage(2);
      screen.setSlots([full(1), full(9)]);
      expect(screen.currentPage).toBe(2);
      expect(qa("article").find((c) => c.dataset.slot === "9")!.querySelector(".mh-sl-scene")).not.toBeNull();
    });

    it("reconstruit une fiche modifiée en gardant le focus sur son bouton", () => {
      const { screen, q } = setup("load", [full(1)]);
      const del = q("[data-slot='1'] .mh-sl-delete") as HTMLButtonElement;
      del.focus();
      screen.setSlots([full(1, { comment: "nouveau" })]);
      expect(document.activeElement).not.toBe(del);
      expect(document.activeElement).toBe(q("[data-slot='1'] .mh-sl-delete"));
    });

    it("le retour du player après une saisie ne reconstruit pas la fiche", () => {
      const { screen, q } = setup("load", [full(1)]);
      const input = q("[data-slot='1'] .mh-sl-comment") as HTMLInputElement;
      input.value = "note";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const card = q("[data-slot='1']");
      screen.setSlots([full(1, { comment: "note" })]);
      expect(q("[data-slot='1']")).toBe(card);
    });

    it("une suppression vide la fiche", () => {
      const { screen, q } = setup("load", [full(1)]);
      screen.setSlots([]);
      expect(q("[data-slot='1']")!.classList.contains("mh-sl-card--empty")).toBe(true);
    });

    it("un changement de langue redessine les libellés", () => {
      const { screen, q } = setup("load", [full(1)]);
      setUiLanguage("en");
      screen.setSlots([full(1)]);
      expect(q(".mh-sl-title")!.textContent).toBe("Load");
      expect(q("[data-slot='1'] .mh-sl-delete")!.textContent).toBe("Delete");
      expect(q(".mh-sl-page")!.getAttribute("aria-label")).toBe("Page 1");
    });
  });
});

describe("garde-fou : aucun libellé en dur dans save-load-screen.ts", () => {
  const source = readFileSync(resolve(__dirname, "../../../src/ui/save-load-screen.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");

  it("aucune chaîne ne contient de lettre accentuée ou de caractère japonais", () => {
    expect(literals.filter((s) => /[À-ÿŒœ぀-ヿ一-鿿]/.test(s))).toEqual([]);
  });
  it("les libellés français d'origine n'apparaissent pas comme littéraux", () => {
    const labels = ["Charger", "Sauvegarder", "Supprimer", "Retour", "Verr.", "Commentaire", "Page"];
    expect(literals.filter((s) => labels.includes(s))).toEqual([]);
  });
});
