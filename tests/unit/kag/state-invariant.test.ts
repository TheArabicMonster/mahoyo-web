/**
 * Invariant d'état persisté (#295).
 *
 * Garde-fou : tout champ de `RuntimeState` doit être **soit sérialisé** par
 * `Runtime.getSaveData()`, **soit** déclaré `transient` ici avec une justification. Le test est
 * double :
 * - **type-level** : `Exclude<keyof RuntimeState, SerializedKeys | TransientKeys>` doit être
 *   `never` (un nouveau champ non déclaré fait échouer `tsc`) ;
 * - **runtime** : les clés réellement produites par `getSaveData().state` sont exactement la
 *   liste sérialisée (aucune omission silencieuse, aucun champ ajouté sans déclaration).
 *
 * Il vérifie aussi l'aller-retour `save → load → getSaveData` : l'état rechargé est identique à
 * l'état sauvegardé (hors champs transitoires), pour tous les domaines implémentés (horloge,
 * actions de message, calques, crédits, audio, effet, ploy…).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime, type RuntimeState } from "@/kag/runtime.js";
import { reduceStage } from "@/kag/stage-state.js";

/**
 * Champs de `RuntimeState` persistés par `getSaveData()` (liste exhaustive et ordonnée).
 * Toute modification de cette liste doit être faite dans la PR qui change la sauvegarde (#295).
 */
const PERSISTED_STATE_KEYS = [
  "fore",
  "back",
  "bgm",
  "bgmPaused",
  "se",
  "seChannels",
  "variables",
  "evalGlobal",
  "textbox",
  "effect",
  "textStyle",
  "ploy",
  "quickMenuLocked",
  "saveLoadEnabled",
  "messageLayer",
  "autoModePaused",
  "clockHour",
  "clockMinute",
  "staffroll",
] as const satisfies readonly (keyof RuntimeState)[];

/**
 * Champs `transient` : volontairement non sauvegardés. Chaque entrée doit être justifiée.
 * - `clickSkipEnabled` / `effectSkipEnabled` : réglages de lecture propres au script et à la
 *   session (@clickskip/@effectskip) ; le moteur les garde dans l'état de fenêtre, pas dans la
 *   sauvegarde, et le port les remet à `true` au début de chaque session (`endSession`).
 * - `ployPaused` / `fallnote` (#282) : état **transitoire** d'effets en cours — la bulle ploy
 *   suspendue par `@pauseploy` et les particules de `@beginfallnote`. Le moteur les restaure via
 *   ses objets de plugin, hors sauvegarde narrative ; le port ne les persiste pas (le prochain
 *   `@pauseploy`/`@beginfallnote` les réinitialise).
 * - `transitionBacklayPending` (#253) : attente de backlay après un `@trans nowait=1` (le `@wt`
 *   suivant copie fore→back). Le moteur ne sauvegarde pas les attentes (`conductor.pendings`) ;
 *   après un load, aucune transition n'est en cours.
 */
const TRANSIENT_STATE_KEYS = [
  "clickSkipEnabled",
  "effectSkipEnabled",
  "ployPaused",
  "fallnote",
  "transitionBacklayPending",
] as const satisfies readonly (keyof RuntimeState)[];

// ── Garde-fou type-level ─────────────────────────────────────────────────────
type SerializedKey = (typeof PERSISTED_STATE_KEYS)[number];
type TransientKey = (typeof TRANSIENT_STATE_KEYS)[number];
/** Clé de RuntimeState ni sérialisée ni déclarée transitoire : jamais (sinon erreur de compile). */
type UncoveredKey = Exclude<keyof RuntimeState, SerializedKey | TransientKey>;
type AssertNever<T extends never> = T;
const _allStateKeysCovered: AssertNever<UncoveredKey> = undefined as unknown as UncoveredKey;
/** Inversement : aucune clé déclarée ne doit être inconnue de RuntimeState. */
type UnknownDeclared = Exclude<SerializedKey | TransientKey, keyof RuntimeState>;
const _noUnknownDeclared: AssertNever<UnknownDeclared> = undefined as unknown as UnknownDeclared;

const SCRIPT = `
*page0|
@bg page=back storage=bg01 effect=monocro blur=2
@fg page=back storage=perso index=1600 id=p1 type=16 effect=nega rotate=10 afx=5 afy=6
@partbg page=back storage=pane width=420 height=576 id=pb1
@dispclock h=6 m=55 left=-800 top=-600 time=300
@setdefaultmessageaction type=swing
@bindbg enabled=1
@staffrollinit face=serif
@staffrolltext size=19 y=100 text=Ligne
@lockquickmenu
@pauseautomode
@noise opacity=128
@play storage=m01
@playpause time=0
@se storage=se01
@eval exp="f.test=42"
@macro name=foo
@italic
@endmacro
@ploysay mode=lu13 ox=1 oy=2
@pg
`;

function makeRuntime(): { runtime: Runtime; parsed: ReturnType<typeof parse> } {
  const parsed = parse(lex(SCRIPT));
  return { runtime: new Runtime(parsed, "t.ks"), parsed };
}

/** Avance le runtime jusqu'à une pause (clic/page) ou la fin. */
function runToStop(runtime: Runtime, maxSteps = 40): void {
  for (let i = 0; i < maxSteps; i++) {
    const step = runtime.step();
    if (step.stop.kind === "click" || step.stop.kind === "end") return;
  }
  throw new Error("runtime: pas de point d'arrêt en 40 pas");
}

const normalize = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("Invariant d'état persisté (#295)", () => {
  it("toutes les clés de RuntimeState sont sérialisées ou déclarées transitoires (type-level)", () => {
    // Les assertions type-level ci-dessus suffisent : ce test échouerait à la compilation (`tsc`)
    // si un champ était ajouté sans être déclaré ni persisté.
    expect(_allStateKeysCovered).toBeUndefined();
    expect(_noUnknownDeclared).toBeUndefined();
  });

  it("getSaveData().state produit exactement les clés déclarées (ni omission, ni ajout)", () => {
    const { runtime } = makeRuntime();
    runToStop(runtime);
    const save = runtime.getSaveData();
    expect(Object.keys(save.state).sort()).toEqual([...PERSISTED_STATE_KEYS].sort());
    for (const key of TRANSIENT_STATE_KEYS) {
      expect(save.state).not.toHaveProperty(key);
    }
  });

  it("les domaines à état récent sont bien présents dans la sauvegarde", () => {
    const { runtime } = makeRuntime();
    runToStop(runtime);
    const state = runtime.getSaveData().state;
    // Horloge (#85)
    expect(state.clockHour).toBe(6);
    expect(state.clockMinute).toBe(55);
    // Action continue des messages (#85)
    expect(state.textbox?.action).toBe("swing");
    // Calques liés au fond (#283)
    expect(state.fore.bindChildren).toBe(true);
    // Horloge (#85) : fond d'horloge et aiguilles persistés après @dispclock.
    expect(state.fore.background).toBe("im03lロビー時計(x2)");
    expect(state.fore.layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(["clock1", "clock2", "clock3", "clock4", "p1", "pb1"]),
    );
    // Apparence des calques (#252)
    expect(state.fore.layers.find((l) => l.id === "p1")).toMatchObject({ type: 16, effect: "nega", afx: 5, afy: 6 });
    expect(state.fore.layers.find((l) => l.id === "pb1")?.crop).toBeDefined();
    // Crédits (#286)
    expect(state.staffroll?.lines[0]?.text).toBe("Ligne");
    // Audio (#285) et état UI/déroulement
    expect(state.bgm).toBe("m01");
    expect(state.bgmPaused).toBe(true);
    expect(state.se).toBe("se01");
    expect(state.quickMenuLocked).toBe(true);
    expect(state.autoModePaused).toBe(true);
    // Effet (#281) et bulle ploy
    expect(state.effect).toMatchObject({ kind: "noise", opacity: 128 });
    expect(state.ploy).toMatchObject({ mode: "lu13", ox: 1, oy: 2 });
    // Variables et sandbox @eval
    expect(state.variables.f.test).toBe(42);
  });

  it("aller-retour save → load : l'état rechargé est identique (tous domaines)", async () => {
    const { runtime, parsed } = makeRuntime();
    runToStop(runtime);
    const saved = runtime.getSaveData();

    const loaded = new Runtime(parsed, "t.ks");
    const ok = await loaded.loadSaveData(saved, new Map([["t.ks", parsed]]));
    expect(ok).toBe(true);

    const reloaded = loaded.getSaveData();
    // État complet (hors champs transitoires, non sérialisés par construction).
    expect(normalize(reloaded.state)).toEqual(normalize(saved.state));
    // Les domaines récents survivent explicitement à l'aller-retour.
    expect(reloaded.state.clockHour).toBe(6);
    expect(reloaded.state.textbox?.action).toBe("swing");
    expect(reloaded.state.fore.bindChildren).toBe(true);
    expect(reloaded.state.staffroll?.lines[0]?.text).toBe("Ligne");
    expect(reloaded.state.bgm).toBe("m01");
    expect(reloaded.state.bgmPaused).toBe(true);
    expect(reloaded.state.effect).toMatchObject({ kind: "noise" });
    expect(reloaded.state.ploy).toMatchObject({ mode: "lu13" });
    // Macros et variables également restaurées.
    const again = loaded.getSaveData();
    expect(normalize(again.macros)).toEqual(normalize(saved.macros));
    expect(again.state.variables.f.test).toBe(42);
  });

  it("un deuxième aller-retour est stable (idempotence)", async () => {
    const { runtime, parsed } = makeRuntime();
    runToStop(runtime);
    const first = runtime.getSaveData();
    const loaded = new Runtime(parsed, "t.ks");
    await loaded.loadSaveData(first, new Map([["t.ks", parsed]]));
    const second = loaded.getSaveData();
    const loaded2 = new Runtime(parsed, "t.ks");
    await loaded2.loadSaveData(second, new Map([["t.ks", parsed]]));
    expect(normalize(loaded2.getSaveData().state)).toEqual(normalize(first.state));
  });
});

describe("Invariant du snapshot d'affichage (#295)", () => {
  it("le snapshot de scène persiste les champs d'affichage attendus", () => {
    const snapshot = reduceStage([
      { kind: "scene", scene: { bg: "bg01", sprites: [], effect: null }, transition: { method: "none" } },
      { kind: "textbox", state: { visible: true, frame: true, action: "swing" }, time: 0 },
      { kind: "text", segments: [{ text: "abc" }] },
      {
        kind: "staffroll",
        state: { lines: [{ text: "L", y: 10, size: 16 }], running: false, height: 100, time: 10, elapsed: 0 },
      },
    ]);
    expect(snapshot.scene.bg).toBe("bg01");
    expect(snapshot.textbox.action).toBe("swing");
    expect(snapshot.text).toEqual([{ text: "abc" }]);
    expect(snapshot.staffroll?.lines[0]?.text).toBe("L");
  });

  it("le snapshot ne contient que les champs d'affichage déclarés", () => {
    // Secousses/effets d'écran et animations ne sont pas persistés (comme `@quake`) : ils sont
    // reconstruits à la volée ; le snapshot ne sérialise que ces 4 champs.
    const snapshot = reduceStage([
      { kind: "scene", scene: { bg: null, sprites: [], effect: null }, transition: { method: "none" } },
    ]);
    expect(Object.keys(snapshot).sort()).toEqual(["scene", "staffroll", "text", "textbox"]);
  });
});
