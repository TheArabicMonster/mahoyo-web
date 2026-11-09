import type { Ms } from "@/kag/events.js";
import type {
  BacklogEntry,
  ConfirmOptions,
  GameSettings,
  OverlayScreen,
  PlayerCommands,
  PlayerStatus,
  SaveSlot,
  ScriptSummary,
  UIManager,
  UIView,
} from "@/ui/types.js";

/**
 * Mock d'UIManager pour les tests d'orchestration du player.
 */
export class FakeUIManager implements UIManager {
  views: UIView[] = [];
  statuses: PlayerStatus[] = [];
  choices: string[][] = [];
  toasts: { message: string; duration?: Ms }[] = [];
  confirms: string[] = [];
  /** Options passées à `confirm`, dans le même ordre que `confirms`. */
  confirmOptions: (ConfirmOptions | undefined)[] = [];
  inputEnabled = true;
  commands: PlayerCommands | null = null;

  init(_root: HTMLElement, commands: PlayerCommands): void {
    this.commands = commands;
  }

  show(view: UIView): void {
    this.views.push(view);
  }

  setStatus(status: Readonly<PlayerStatus>): void {
    this.statuses.push({ ...status });
  }

  showChoices(options: readonly string[]): void {
    this.choices.push([...options]);
  }

  hideChoices(): void {
    this.choices.push([]);
  }

  async confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
    this.confirms.push(message);
    this.confirmOptions.push(options);
    return true;
  }

  toast(message: string, duration?: Ms): void {
    this.toasts.push({ message, duration });
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
  }

  dispose(): void {
    this.views = [];
    this.statuses = [];
    this.choices = [];
    this.toasts = [];
    this.confirms = [];
    this.confirmOptions = [];
  }
}
