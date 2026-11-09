import { describe, it, expect } from "vitest";
import {
  HistoryRouter,
  ROUTES,
  isOverlayRoute,
  overlayOfRoute,
  parseRoute,
  resolveRoute,
  routeRequiresGame,
  serializeRoute,
  viewRoute,
  type Route,
} from "@/ui/router.js";
import { FakeBrowserHistory } from "../mocks/fake-browser-history.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("parseRoute / serializeRoute", () => {
  it("fait l'aller-retour pour chaque route", () => {
    for (const route of ROUTES) expect(parseRoute(serializeRoute(route))).toBe(route);
  });

  it("sérialise en hash, sans chemin", () => {
    expect(serializeRoute("load")).toBe("#/load");
    expect(serializeRoute("flowchart")).toBe("#/flowchart");
  });

  it("tolère casse, barre finale et # sans barre", () => {
    expect(parseRoute("#/LOAD")).toBe("load");
    expect(parseRoute("#/config/")).toBe("config");
    expect(parseRoute("#backlog")).toBe("backlog");
  });

  it("refuse le vide, les inconnus, les sous-chemins et les paramètres (pas de contenu de scénario dans l'URL)", () => {
    for (const hash of ["", "#", "#/", "#/nope", "#/game/1-0", "#/load?slot=3", "#/save/12", "/load", "#/../load", "#/g%61me"]) {
      expect(parseRoute(hash)).toBeNull();
    }
  });

  it("ne lève pas sur une entrée non textuelle", () => {
    expect(parseRoute(undefined as unknown as string)).toBeNull();
  });
});

describe("resolveRoute", () => {
  it("garde les routes atteignables", () => {
    expect(resolveRoute("config", { inGame: false })).toBe("config");
    expect(resolveRoute("load", { inGame: false })).toBe("load");
    expect(resolveRoute("flowchart", { inGame: false })).toBe("flowchart");
    expect(resolveRoute("title", { inGame: true })).toBe("title");
  });

  it("replie sur le titre ce qui exige une partie, ou une route inconnue", () => {
    for (const route of ["game", "save", "backlog"] as Route[]) {
      expect(routeRequiresGame(route)).toBe(true);
      expect(resolveRoute(route, { inGame: false })).toBe("title");
      expect(resolveRoute(route, { inGame: true })).toBe(route);
    }
    expect(resolveRoute(null, { inGame: true })).toBe("title");
  });
});

describe("viewRoute / overlayOfRoute", () => {
  it("déduit la route de la vue", () => {
    expect(viewRoute({ inGame: false, top: undefined })).toBe("title");
    expect(viewRoute({ inGame: true, top: undefined })).toBe("game");
    expect(viewRoute({ inGame: true, top: "pause" })).toBe("game");
    expect(viewRoute({ inGame: true, top: "settings" })).toBe("config");
    expect(viewRoute({ inGame: false, top: "load" })).toBe("load");
    expect(viewRoute({ inGame: true, top: "backlog" })).toBe("backlog");
  });

  it("associe chaque route d'écran à son OverlayScreen", () => {
    expect(overlayOfRoute("config")).toBe("settings");
    expect(overlayOfRoute("flowchart")).toBe("flowchart");
    expect(overlayOfRoute("title")).toBeUndefined();
    expect(overlayOfRoute("game")).toBeUndefined();
    expect(ROUTES.filter(isOverlayRoute)).toEqual(["load", "save", "config", "backlog", "flowchart"]);
  });
});

function start(initialHash = "", inGame = false) {
  const host = new FakeBrowserHistory(initialHash);
  const navigations: (Route | null)[] = [];
  const router = new HistoryRouter(host);
  const { initial, stop } = router.start((r) => navigations.push(r), { inGame });
  return { host, router, navigations, initial, stop };
}

describe("HistoryRouter", () => {
  it("sans hash : remplace par #/title, une seule entrée", () => {
    const { host, initial } = start();
    expect(initial).toBe("title");
    expect(host.hashes).toEqual(["#/title"]);
  });

  it("lien direct vers un écran : le titre sert de base, l'écran est empilé", () => {
    const { host, initial } = start("#/load");
    expect(initial).toBe("load");
    expect(host.hashes).toEqual(["#/title", "#/load"]);
    expect(host.index).toBe(1);
  });

  it("lien direct vers un écran qui exige une partie : repli propre sur le titre", () => {
    for (const hash of ["#/game", "#/save", "#/backlog", "#/inconnu"]) {
      const { host, initial } = start(hash);
      expect(initial).toBe("title");
      expect(host.hashes).toEqual(["#/title"]);
    }
  });

  it("ouvrir un écran empile, le fermer dépile (aucune croissance de l'historique)", async () => {
    const { host, router } = start();
    for (let i = 0; i < 3; i++) {
      router.publish("config");
      expect(host.hashes).toEqual(["#/title", "#/config"]);
      router.publish("title");
      await tick();
      expect(host.location.hash).toBe("#/title");
      expect(host.index).toBe(0);
    }
    expect(host.backCalls).toBe(3);
  });

  it("titre -> partie remplace l'entrée (le précédent ne ramène pas au titre)", () => {
    const { host, router } = start();
    router.publish("game");
    expect(host.hashes).toEqual(["#/game"]);
  });

  it("charger depuis #/load remplace l'écran par la partie, puis un écran de la partie se referme par précédent", async () => {
    const { host, router } = start();
    router.publish("load");
    router.publish("game");
    expect(host.hashes).toEqual(["#/title", "#/game"]);
    router.publish("save");
    expect(host.hashes).toEqual(["#/title", "#/game", "#/save"]);
    router.publish("game");
    await tick();
    expect(host.index).toBe(1);
    expect(host.location.hash).toBe("#/game");
  });

  it("précédent du navigateur : le routeur demande la route précédente au player", async () => {
    const { host, router, navigations } = start();
    router.publish("config");
    host.go(-1);
    await tick();
    expect(navigations).toEqual(["title"]);
  });

  it("hash tapé à la main : route transmise, null si inconnue", () => {
    const { host, navigations } = start();
    host.typeHash("#/flowchart");
    host.typeHash("#/zzz");
    expect(navigations).toEqual(["flowchart", null]);
  });

  it("la réponse du player à une navigation réaligne l'URL sans empiler (repli sur le titre)", () => {
    const host = new FakeBrowserHistory();
    const router = new HistoryRouter(host);
    router.start(() => router.publish("title"), { inGame: false });
    host.typeHash("#/save");
    expect(host.location.hash).toBe("#/title");
  });

  it("route inchangée par le player après une navigation : l'URL revient à la vue réelle", () => {
    const host = new FakeBrowserHistory();
    const router = new HistoryRouter(host);
    router.start(() => {}, { inGame: false });
    host.typeHash("#/config"); // le player refuse (pas de publish)
    expect(host.location.hash).toBe("#/title");
  });

  it("le retour provoqué par la fermeture d'un écran n'est pas retransmis au player", async () => {
    const { router, navigations } = start();
    router.publish("config");
    router.publish("title");
    await tick();
    expect(navigations).toEqual([]);
  });

  it("aller-retours répétés sans boucle d'historique", async () => {
    const { host, router } = start();
    for (let i = 0; i < 5; i++) {
      router.publish("load");
      host.go(-1);
      await tick();
      router.publish("title");
    }
    expect(host.entries.length).toBeLessThanOrEqual(2);
    expect(host.location.hash).toBe("#/title");
  });

  it("conserve chemin et requête de la page", () => {
    const host = new FakeBrowserHistory();
    host.pathname = "/mahoyo/";
    host.search = "?lang=fr";
    new HistoryRouter(host).start(() => {}, { inGame: false });
    expect(host.hashes).toEqual(["#/title"]);
  });

  it("ne lève jamais si l'API d'historique échoue", () => {
    const host = new FakeBrowserHistory("#/config");
    host.throwing = true;
    const router = new HistoryRouter(host);
    expect(() => {
      router.start(() => {}, { inGame: false });
      router.publish("title");
      router.publish("load");
      router.publish("game");
    }).not.toThrow();
  });

  it("stop() détache l'écoute", async () => {
    const { host, navigations, stop } = start();
    stop();
    host.typeHash("#/load");
    expect(navigations).toEqual([]);
  });
});
