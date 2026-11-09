import type { RouterHost } from "@/ui/router.js";

type Entry = { hash: string; state: unknown };

/**
 * Historique de navigateur minimal pour tester le routeur : pile d'entrées, `pushState` / `replaceState` sans
 * événement, `back()` / `forward()` asynchrones qui déclenchent `hashchange` quand le hash change.
 */
export class FakeBrowserHistory implements RouterHost {
  entries: Entry[];
  index = 0;
  pathname = "/";
  search = "";
  private listeners = new Set<() => void>();
  /** Fait lever l'API d'historique (iframe sandbox, etc.). */
  throwing = false;
  backCalls = 0;

  constructor(initialHash = "") {
    this.entries = [{ hash: initialHash, state: null }];
  }

  get location() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getter d'objet : `this` désigne l'objet retourné, pas l'instance
    const self = this;
    return {
      get hash() {
        return self.entries[self.index]!.hash;
      },
      get pathname() {
        return self.pathname;
      },
      get search() {
        return self.search;
      },
    };
  }

  get history() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getter d'objet : `this` désigne l'objet retourné, pas l'instance
    const self = this;
    return {
      get state() {
        return self.entries[self.index]!.state;
      },
      pushState(state: unknown, _unused: string, url?: string | null) {
        if (self.throwing) throw new Error("SecurityError");
        self.entries.length = self.index + 1;
        self.entries.push({ hash: hashOf(url), state });
        self.index += 1;
      },
      replaceState(state: unknown, _unused: string, url?: string | null) {
        if (self.throwing) throw new Error("SecurityError");
        self.entries[self.index] = { hash: hashOf(url), state };
      },
      back() {
        if (self.throwing) throw new Error("SecurityError");
        self.backCalls++;
        self.go(-1);
      },
    };
  }

  addEventListener(_type: "hashchange", listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "hashchange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** Traversée asynchrone, comme un vrai navigateur ; `hashchange` seulement si le hash change. */
  go(delta: number): void {
    const target = this.index + delta;
    if (target < 0 || target >= this.entries.length) return;
    queueMicrotask(() => {
      const before = this.entries[this.index]!.hash;
      this.index = target;
      if (this.entries[this.index]!.hash !== before) for (const l of [...this.listeners]) l();
    });
  }

  /** Saisie manuelle d'un hash dans la barre d'adresse : nouvelle entrée + `hashchange`. */
  typeHash(hash: string): void {
    this.entries.length = this.index + 1;
    this.entries.push({ hash, state: null });
    this.index += 1;
    for (const l of [...this.listeners]) l();
  }

  get hashes(): string[] {
    return this.entries.map((e) => e.hash);
  }
}

function hashOf(url?: string | null): string {
  const i = (url ?? "").indexOf("#");
  return i >= 0 ? (url as string).slice(i) : "";
}
