/**
 * Tests de l'enregistrement PWA et de la mise à jour contrôlée (issue #96).
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import {
  RELOAD_GUARD_KEY,
  createPwaUpdateController,
  registerPwa,
} from "../../../src/pwa/register.js";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    data,
  };
}

describe("createPwaUpdateController", () => {
  it("active la mise à jour (SKIP_WAITING) puis recharge une seule fois", () => {
    const postSkipWaiting = vi.fn();
    const reload = vi.fn();
    const storage = fakeStorage();
    const controller = createPwaUpdateController({ postSkipWaiting, reload, storage });

    controller.notifyUpdateInstalled({ postMessage: vi.fn() });
    expect(postSkipWaiting).toHaveBeenCalledTimes(1);

    controller.handleControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.data.get(RELOAD_GUARD_KEY)).toBe("1");

    // Une seconde notification/activation ne recharge pas à nouveau.
    controller.handleControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne recharge pas la première installation (aucune mise à jour notifiée)", () => {
    const reload = vi.fn();
    const controller = createPwaUpdateController({
      postSkipWaiting: vi.fn(),
      reload,
      storage: fakeStorage(),
    });

    controller.handleControllerChange();
    expect(reload).not.toHaveBeenCalled();
  });

  it("respecte le garde-fou de session (pas de boucle de rechargement)", () => {
    const reload = vi.fn();
    const controller = createPwaUpdateController({
      postSkipWaiting: vi.fn(),
      reload,
      storage: fakeStorage({ [RELOAD_GUARD_KEY]: "1" }),
    });

    controller.notifyUpdateInstalled({ postMessage: vi.fn() });
    controller.handleControllerChange();
    expect(reload).not.toHaveBeenCalled();
  });

  it("n'envoie qu'un seul SKIP_WAITING pour plusieurs notifications", () => {
    const postSkipWaiting = vi.fn();
    const controller = createPwaUpdateController({
      postSkipWaiting,
      reload: vi.fn(),
      storage: fakeStorage(),
    });
    controller.notifyUpdateInstalled({ postMessage: vi.fn() });
    controller.notifyUpdateInstalled({ postMessage: vi.fn() });
    expect(postSkipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe("registerPwa", () => {
  it("ne fait rien quand c'est désactivé (développement ou paramètre)", async () => {
    await expect(registerPwa({ enabled: false })).resolves.toBeNull();
  });

  it("ne fait rien si Service Worker n'est pas supporté", async () => {
    // En environnement node, `navigator` existe (Node ≥ 20) mais sans serviceWorker.
    await expect(registerPwa({ enabled: true })).resolves.toBeNull();
  });
});
