/**
 * Écran de sauvegarde et de chargement (HUD-10 / #196, docs/ANALYSE_HUD_ORIGINAL.md §2.3 et §2.7).
 *
 * Grille de 2 colonnes × 4 lignes (8 fiches par page), 15 pages, fiche d'emplacement complète : vignette 16:9, titre
 * de scène, date `AAAA/MM/JJ hh:mm:ss`, commentaire, case « Verr. », boutons *Supprimer* et *Charger* (ou *Sauvegarder*).
 * L'écran est dessiné sur le fond « nuit bleue » (`mh-ui-night`, posé par `DomUIManager`) en CSS pur, sans asset.
 *
 * Le module ne connaît ni le player ni le stockage : il reçoit les emplacements (`setSlots`) et appelle les
 * commandes injectées. Chaque rafraîchissement ne reconstruit que les fiches modifiées, pour conserver le focus et
 * ne pas perdre un clic qui suit la saisie d'un commentaire.
 *
 * Confirmations (HUD-05) : *Charger* demande confirmation ici, *Oui* présélectionné (aucune perte). L'écrasement et la
 * suppression sont confirmés par le player (`save`, `deleteSave`), *Non* présélectionné, et refusés sur un emplacement
 * verrouillé : le bouton *Supprimer* est alors désactivé et *Sauvegarder* explique le refus par un message.
 */
import { decoKeyOf, getUiLanguage, t } from "./i18n.js";
import {
  clampPage,
  formatSaveDate,
  isSpecialSlot,
  moveCursor,
  paginate,
  SAVE_COMMENT_MAX_LENGTH,
  SAVE_COLUMNS_PORTRAIT,
  SAVE_SLOTS_PER_PAGE,
  SAVE_SLOTS_PER_PAGE_PORTRAIT,
  pageCountFor,
  type GridKey,
} from "./save-pages.js";
import type { ConfirmOptions, PlayerCommands, SaveSlot, SlotId } from "./types.js";
import "./save-load-screen.css";

export type SaveLoadMode = "save" | "load";

/** Export et import JSON des sauvegardes (WEB-03, #198) ; absents : les deux boutons ne sont pas affichés. */
export interface SaveTransferActions {
  /** Télécharge le fichier d'export ; renvoie le message à afficher. */
  export(): Promise<string>;
  /** Ouvre le sélecteur de fichier puis importe ; null si le joueur annule. `imported` : au moins un emplacement écrit. */
  import(): Promise<{ message: string; imported: boolean } | null>;
}

/** Délai avant le rechargement de la page qui suit un import (laisse lire le message). */
export const RELOAD_AFTER_IMPORT_MS = 2200;

export interface SaveLoadDeps {
  mode: SaveLoadMode;
  commands: Pick<PlayerCommands, "save" | "load" | "deleteSave" | "updateSave" | "closeScreen">;
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;
  toast(message: string): void;
  transfer?: SaveTransferActions;
  /** Rechargement de la page après un import (la progression fusionnée n'est lue qu'au démarrage). */
  reload?: () => void;
  /** Faux pendant un chargement : les boutons n'agissent plus. */
  isInputEnabled(): boolean;
}

type SlotData = NonNullable<SaveSlot["data"]>;
type El = HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Nom affiché d'un emplacement ("Slot 3", "Sauvegarde rapide"…). */
export function slotName(id: SlotId): string {
  if (id === "quick") return t("slot.quick");
  if (id === "auto") return t("slot.auto");
  return t("slot.numbered", { n: id });
}

function badgeLabel(id: "auto" | "quick"): string {
  return id === "auto" ? t("slot.badgeAuto") : t("slot.badgeQuick");
}

/** Résumé comparable d'une fiche : deux fiches de même signature se dessinent à l'identique. */
function signature(slot: SaveSlot): string {
  const d = slot.data;
  return JSON.stringify([
    slot.id,
    d && [d.timestamp, d.sceneTitle ?? "", d.scriptFile, d.comment ?? "", d.locked === true, d.thumbnailUrl ?? ""],
  ]);
}

function copySlot(slot: SaveSlot): SaveSlot {
  return { id: slot.id, data: slot.data ? { ...slot.data } : null };
}

const GRID_KEYS: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

export class SaveLoadScreen {
  readonly element: El;
  readonly mode: SaveLoadMode;

  private readonly deps: SaveLoadDeps;
  private readonly header: El;
  private readonly grid: El;
  private readonly pager: El;
  private readonly status: El;
  private readonly back: HTMLButtonElement;
  private readonly transfer: El;

  /** Disposition portrait (#210) : 1 colonne × 4 fiches par page, 30 pages. */
  private readonly portrait: boolean;
  private readonly perPage: number;
  private readonly columns: number;
  private readonly pageCount: number;
  private pages: SaveSlot[][] = [];
  private cards: El[] = [];
  private sigs: string[] = [];
  private page = 1;
  private cursor = 0;
  private renderedPage = 0;
  private renderedLang = "";

  constructor(deps: SaveLoadDeps) {
    this.deps = deps;
    this.mode = deps.mode;
    // #210 : en portrait, 1 colonne × 4 lignes par page (le paysage garde 2 × 4 et 15 pages).
    this.portrait =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(orientation: portrait)").matches;
    this.perPage = this.portrait ? SAVE_SLOTS_PER_PAGE_PORTRAIT : SAVE_SLOTS_PER_PAGE;
    this.columns = this.portrait ? SAVE_COLUMNS_PORTRAIT : 2;
    this.pageCount = pageCountFor(this.perPage);
    this.pages = paginate([], this.perPage);
    this.element = h("section", `mh-sl mh-sl-${deps.mode}`);
    // Écran superposé plein cadre (#211) : dialogue modal nommé par `aria-label` (posé au rendu).
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "true");
    this.header = h("header", "mh-sl-header");
    this.grid = h("div", "mh-sl-grid");
    this.grid.setAttribute("role", "group");
    this.pager = h("nav", "mh-sl-pager");
    this.status = h("p", "mh-sl-sr");
    this.status.setAttribute("role", "status");
    this.back = this.makeButton("mh-sl-back", () => deps.commands.closeScreen());
    this.back.dataset.focusKey = "back";
    this.transfer = h("div", "mh-sl-transfer");
    this.element.append(this.header, this.transfer, this.grid, this.pager, this.back, this.status);
    this.element.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.element.addEventListener("focusin", (e) => this.onFocusIn(e));
  }

  /** Page affichée (1 à 15). */
  get currentPage(): number {
    return this.page;
  }

  /** Remplace les emplacements affichés (appelé à chaque `show` de la vue, y compris après une action). */
  setSlots(slots: readonly SaveSlot[]): void {
    this.pages = paginate(slots, this.perPage).map((p) => p.map(copySlot));
    this.sync();
  }

  goToPage(page: number, focusKey?: string): void {
    const next = clampPage(page, this.perPage);
    if (next === this.page && this.renderedPage === next) return;
    this.page = next;
    this.sync(focusKey);
  }

  // ── Rendu ──

  private sync(forceFocusKey?: string): void {
    const focusKey = forceFocusKey ?? this.activeFocusKey();
    const lang = getUiLanguage();
    if (lang !== this.renderedLang) {
      this.renderedLang = lang;
      this.renderHeader();
      this.back.textContent = t("common.back");
      this.renderedPage = 0; // le sélecteur et les fiches se redessinent dans la nouvelle langue
    }
    if (this.renderedPage !== this.page) {
      this.renderedPage = this.page;
      this.sigs = [];
      this.renderPager();
      this.status.textContent = t("slots.pageStatus", { n: this.page, total: this.pageCount });
      this.grid.setAttribute("aria-label", t("slots.pageStatus", { n: this.page, total: this.pageCount }));
    }
    const slots = this.pages[this.page - 1] ?? [];
    for (let i = 0; i < this.perPage; i++) {
      const slot = slots[i];
      if (!slot) continue;
      const sig = signature(slot);
      const old = this.cards[i];
      if (old && this.sigs[i] === sig) continue;
      const card = this.renderCard(slot, i);
      if (old) old.replaceWith(card);
      else this.grid.appendChild(card);
      this.cards[i] = card;
      this.sigs[i] = sig;
    }
    if (focusKey && !this.element.contains(document.activeElement)) this.focusKey(focusKey);
  }

  private renderHeader(): void {
    const key = this.mode === "save" ? "slots.saveTitle" : "slots.loadTitle";
    const title = h("h2", "mh-sl-title", t(key));
    const sub = h("span", "mh-sl-subtitle", t(decoKeyOf(key)));
    sub.setAttribute("aria-hidden", "true");
    this.header.replaceChildren(title, sub);
    this.element.setAttribute("aria-label", t(key));
    this.renderTransfer();
  }

  /** Boutons Exporter / Importer (fichier JSON), seulement si le store sait les servir. */
  private renderTransfer(): void {
    const actions = this.deps.transfer;
    if (!actions) return;
    const exportBtn = this.makeButton("mh-sl-btn mh-sl-export", () => void this.runExport(actions), t("slots.export"));
    exportBtn.dataset.focusKey = "export";
    const importBtn = this.makeButton("mh-sl-btn mh-sl-import", () => void this.runImport(actions), t("slots.import"));
    importBtn.dataset.focusKey = "import";
    this.transfer.replaceChildren(exportBtn, importBtn);
  }

  private async runExport(actions: SaveTransferActions): Promise<void> {
    try {
      this.deps.toast(await actions.export());
    } catch {
      this.deps.toast(t("toast.saveFailed"));
    }
  }

  private async runImport(actions: SaveTransferActions): Promise<void> {
    try {
      const result = await actions.import();
      if (!result) return;
      this.deps.toast(result.message);
      if (result.imported) setTimeout(() => (this.deps.reload ?? (() => window.location.reload()))(), RELOAD_AFTER_IMPORT_MS);
    } catch {
      this.deps.toast(t("toast.saveFailed"));
    }
  }

  private renderPager(): void {
    this.pager.setAttribute("aria-label", t("slots.pagesLabel"));
    const list = h("ol", "mh-sl-pages");
    for (let n = 1; n <= this.pageCount; n++) {
      const li = h("li");
      const btn = this.makeButton("mh-sl-page", () => this.goToPage(n, `page-${n}`), String(n));
      btn.setAttribute("aria-label", t("slots.pageAria", { n }));
      btn.dataset.focusKey = `page-${n}`;
      if (n === this.page) btn.setAttribute("aria-current", "page");
      li.appendChild(btn);
      list.appendChild(li);
    }
    this.pager.replaceChildren(list);
  }

  private renderCard(slot: SaveSlot, index: number): El {
    const d = slot.data;
    const name = slotName(slot.id);
    const card = h("article", "mh-sl-card");
    card.dataset.slot = String(slot.id);
    card.dataset.focusKey = `card-${index}`;
    card.tabIndex = index === this.cursor ? 0 : -1;
    card.setAttribute(
      "aria-label",
      d
        ? t("slot.ariaFilled", { name, title: d.sceneTitle || d.scriptFile, date: formatSaveDate(d.timestamp) })
        : t("slot.ariaEmpty", { name }),
    );
    if (isSpecialSlot(slot.id)) card.classList.add("mh-sl-card--special", `mh-sl-card--${slot.id}`);
    if (!d) card.classList.add("mh-sl-card--empty");

    const nameEl = isSpecialSlot(slot.id)
      ? h("span", "mh-sl-name mh-sl-badge", badgeLabel(slot.id))
      : h("span", "mh-sl-name", name);
    if (isSpecialSlot(slot.id)) nameEl.title = name;

    if (!d) {
      // Emplacement vide : cadre sombre. Seule la marque d'un emplacement spécial, et le bouton en mode sauvegarde.
      if (isSpecialSlot(slot.id)) card.appendChild(nameEl);
      if (this.mode === "save") {
        if (!isSpecialSlot(slot.id)) card.appendChild(nameEl);
        card.classList.add("mh-sl-card--saveable");
        card.appendChild(this.makeActions(slot, index));
      }
      return card;
    }

    const thumb = h("div", "mh-sl-thumb");
    if (d.thumbnailUrl) {
      const img = h("img");
      img.src = d.thumbnailUrl;
      img.alt = "";
      img.decoding = "async";
      thumb.appendChild(img);
    }

    const info = h("div", "mh-sl-info");
    const head = h("div", "mh-sl-head");
    const scene = h("h3", "mh-sl-scene", d.sceneTitle || d.scriptFile);
    scene.title = scene.textContent ?? "";
    head.append(nameEl, scene);
    const date = h("p", "mh-sl-date");
    const time = h("time", undefined, formatSaveDate(d.timestamp));
    time.dateTime = new Date(d.timestamp).toISOString();
    date.appendChild(time);
    info.append(head, date, this.makeComment(slot, index));

    card.append(thumb, info, this.makeLock(slot, index), this.makeActions(slot, index));
    return card;
  }

  private makeComment(slot: SaveSlot, index: number): HTMLInputElement {
    const d = slot.data as SlotData;
    const input = h("input", "mh-sl-comment");
    input.type = "text";
    input.maxLength = SAVE_COMMENT_MAX_LENGTH;
    input.value = d.comment ?? "";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", t("slot.commentAria", { name: slotName(slot.id) }));
    input.dataset.focusKey = `card-${index}:comment`;
    input.addEventListener("change", () => {
      const value = input.value.trim().slice(0, SAVE_COMMENT_MAX_LENGTH);
      input.value = value;
      if (value === (d.comment ?? "")) return;
      d.comment = value;
      this.sigs[index] = signature(slot); // le rafraîchissement du player ne reconstruit pas la fiche
      void this.deps.commands.updateSave(slot.id, { comment: value });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Échap annule la saisie en cours et rend le focus à la fiche ; l'écran reste ouvert.
      e.stopPropagation();
      input.value = d.comment ?? "";
      this.cards[index]?.focus();
    });
    return input;
  }

  private makeLock(slot: SaveSlot, index: number): El {
    const d = slot.data as SlotData;
    const label = h("label", "mh-sl-lock");
    const box = h("input");
    box.type = "checkbox";
    box.checked = d.locked === true;
    box.dataset.focusKey = `card-${index}:lock`;
    box.setAttribute("aria-label", t("slot.lockAria", { name: slotName(slot.id) }));
    box.addEventListener("change", () => {
      d.locked = box.checked;
      this.sigs[index] = signature(slot);
      this.applyLock(this.cards[index], d.locked);
      void this.deps.commands.updateSave(slot.id, { locked: box.checked });
    });
    label.append(box, h("span", "mh-sl-lock-text", t("slot.lock")));
    return label;
  }

  /** État dépendant du verrou : suppression désactivée, sauvegarde par-dessus refusée. */
  private applyLock(card: El | undefined, locked: boolean): void {
    if (!card) return;
    card.classList.toggle("mh-sl-card--locked", locked);
    const del = card.querySelector<HTMLButtonElement>(".mh-sl-delete");
    if (del) del.disabled = locked;
    const save = card.querySelector<HTMLButtonElement>(".mh-sl-save");
    if (save) save.setAttribute("aria-disabled", locked ? "true" : "false");
  }

  private makeActions(slot: SaveSlot, index: number): El {
    const d = slot.data;
    const name = slotName(slot.id);
    const row = h("div", "mh-sl-actions");
    if (d) {
      const del = this.makeButton("mh-sl-btn mh-sl-delete", () => void this.deps.commands.deleteSave(slot.id), t("slot.delete"));
      del.setAttribute("aria-label", t("slot.actionAria", { action: t("slot.delete"), name }));
      del.dataset.focusKey = `card-${index}:delete`;
      del.disabled = d.locked === true;
      row.appendChild(del);
    }
    const label = this.mode === "save" ? t("slot.save") : t("slot.load");
    const main = this.makeButton(
      `mh-sl-btn mh-sl-primary ${this.mode === "save" ? "mh-sl-save" : "mh-sl-load"}`,
      () => void this.primaryAction(slot),
      label,
    );
    main.setAttribute("aria-label", t("slot.actionAria", { action: label, name }));
    main.dataset.focusKey = `card-${index}:main`;
    if (this.mode === "save" && d?.locked) main.setAttribute("aria-disabled", "true");
    row.appendChild(main);
    return row;
  }

  private makeButton(cls: string, onClick: () => void, text?: string): HTMLButtonElement {
    const btn = h("button", cls, text);
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (this.deps.isInputEnabled()) onClick();
    });
    return btn;
  }

  // ── Actions ──

  /** Action principale d'une fiche : charger (avec confirmation) ou sauvegarder. */
  private async primaryAction(slot: SaveSlot): Promise<void> {
    const name = slotName(slot.id);
    if (this.mode === "load") {
      if (!slot.data) return;
      // Charger ne perd rien d'enregistré : *Oui* est présélectionné (HUD-05).
      if (await this.deps.confirm(t("slot.confirmLoad", { name }), { defaultButton: "yes" })) {
        await this.deps.commands.load(slot.id);
      }
      return;
    }
    if (slot.data?.locked) {
      this.deps.toast(t("toast.slotLockedOverwrite"));
      return;
    }
    // L'éventuelle confirmation d'écrasement (Non par défaut) est demandée par le player.
    await this.deps.commands.save(slot.id);
  }

  // ── Clavier et focus ──

  private onFocusIn(e: FocusEvent): void {
    const card = e.target instanceof Element ? e.target.closest<El>(".mh-sl-card") : null;
    const index = card ? this.cards.indexOf(card) : -1;
    if (index >= 0) this.setCursor(index);
  }

  private setCursor(index: number): void {
    this.cursor = index;
    this.cards.forEach((c, i) => (c.tabIndex = i === index ? 0 : -1));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target || (target instanceof HTMLInputElement && target.type === "text")) return;
    const onCard = target.classList.contains("mh-sl-card");
    const inPager = this.pager.contains(target);

    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const next = clampPage(this.page + (e.key === "PageDown" ? 1 : -1), this.perPage);
      this.goToPage(next, inPager ? `page-${next}` : `card-${this.cursor}`);
      return;
    }
    if (inPager && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const next = clampPage(this.page + (e.key === "ArrowRight" ? 1 : -1), this.perPage);
      this.goToPage(next, `page-${next}`);
      return;
    }
    if (onCard && GRID_KEYS.includes(e.key)) {
      e.preventDefault();
      const next = moveCursor(this.cursor, e.key as GridKey, this.columns);
      this.setCursor(next);
      this.cards[next]?.focus();
      return;
    }
    if (onCard && e.key === "Enter") {
      e.preventDefault();
      const slot = this.pages[this.page - 1]?.[this.cards.indexOf(target)];
      if (slot && this.deps.isInputEnabled()) void this.primaryAction(slot);
    }
  }

  private activeFocusKey(): string | undefined {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.element.contains(active)) return undefined;
    return active.dataset.focusKey;
  }

  /** Redonne le focus à l'élément portant cette clé, ou à défaut à sa fiche. */
  private focusKey(key: string): void {
    const find = (k: string): HTMLElement | null =>
      [...this.element.querySelectorAll<HTMLElement>("[data-focus-key]")].find((el) => el.dataset.focusKey === k) ?? null;
    const target = find(key) ?? find(key.split(":")[0]!);
    target?.focus({ preventScroll: true });
  }
}

export function createSaveLoadScreen(deps: SaveLoadDeps): SaveLoadScreen {
  return new SaveLoadScreen(deps);
}
