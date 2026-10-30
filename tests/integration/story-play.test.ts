/**
 * Test d'intégration : joue l'histoire en suivant la table d'enchaînement.
 *
 * Contrairement à la lecture complète (qui lit chaque script isolément), ce test
 * enchaîne les scripts comme le fait le player : à la fin d'un script, on
 * consulte `story-chain.json` et on charge le suivant dans le même runtime.
 *
 * Nécessite les assets locaux (MAHOYO_ASSETS_DIR ou public/assets) et la table
 * générée par `npm run chain`. Sans l'un des deux, le test est ignoré.
 * Aucun texte original n'est affiché : seulement des noms de scripts et des compteurs.
 *
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { parseStoryChain, resolveNext } from "@/core/story-chain.js";
import { parseTimelineData } from "@/core/timeline.js";
import { listCorpus } from "../../tools/audit-lib.js";
import { hasAssets, assetsDir, scenarioDir } from "./skip-if-no-assets.js";

const chainPath = hasAssets && assetsDir ? join(assetsDir, "story-chain.json") : "";
const hasChain = chainPath !== "" && existsSync(chainPath);
const timelinesPath = hasAssets && assetsDir ? join(assetsDir, "timelines.json") : "";
const timelines = timelinesPath !== "" && existsSync(timelinesPath) ? parseTimelineData(JSON.parse(readFileSync(timelinesPath, "utf-8"))) : null;

/** Plafonds de sécurité (le chemin principal compte environ 130 scripts). */
const MAX_SCRIPTS = 400;
const MAX_STEPS_PER_SCRIPT = 10_000;

describe.skipIf(!hasChain)("Enchaînement de l'histoire (vrais assets)", () => {
  const chain = hasChain ? parseStoryChain(JSON.parse(readFileSync(chainPath, "utf-8"))) : null;

  it("la table est valide et ne cite que des scripts présents", () => {
    expect(chain).not.toBeNull();
    const present = new Set(listCorpus(scenarioDir).allKsFiles.map((f) => f.toLowerCase()));
    const cited = new Set<string>([chain!.first]);
    for (const [from, routes] of Object.entries(chain!.next)) {
      cited.add(from);
      for (const r of routes) {
        cited.add(r.to);
        for (const t of r.then ?? []) cited.add(t);
      }
    }
    const missing = [...cited].filter((f) => !present.has(f.toLowerCase()));
    expect(missing).toEqual([]);
  });

  it("joue l'histoire d'un script à l'autre sans erreur ni boucle", async () => {
    const { scriptTexts } = listCorpus(scenarioDir);
    const textOf = (file: string): string | undefined => {
      const exact = scriptTexts.get(file);
      if (exact !== undefined) return exact;
      const lower = file.toLowerCase();
      for (const [k, v] of scriptTexts) if (k.toLowerCase() === lower) return v;
      return undefined;
    };

    const first = textOf(chain!.first);
    expect(first).toBeDefined();
    const runtime = new Runtime(parse(lex(first!)), chain!.first);
    runtime.timelines = timelines;
    runtime.scriptLoader = async (storage: string) => {
      const t = textOf(storage);
      return t === undefined ? null : parse(lex(t));
    };

    const played: string[] = [chain!.first];
    const queue: string[] = [];
    const errors: string[] = [];
    const stalled: string[] = [];
    let current = chain!.first;
    let timelineStops = 0;

    for (let scripts = 0; scripts < MAX_SCRIPTS; scripts++) {
      // Joue le script courant jusqu'à sa fin (les pauses sont franchies).
      let steps = 0;
      let ended = false;
      while (steps++ < MAX_STEPS_PER_SCRIPT) {
        try {
          const step = runtime.step();
          if (step.stop.kind === "timeline") timelineStops++;
          if (step.stop.kind === "end") { ended = true; break; }
          if (step.stop.kind === "loadScript") {
            const ok = await runtime.loadScript(step.stop.file, step.stop.label, step.stop.pushCallStack ?? true);
            if (!ok) break;
          }
        } catch (err) {
          errors.push(`${current} : ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }
      if (!ended && errors.length === 0) stalled.push(current);
      if (!ended) break;

      // Suite : file d'interlude, sinon table (première option pour un choix).
      let file = queue.shift();
      if (file === undefined) {
        const next = resolveNext(chain!, current, (e) => runtime.evaluateCondition(e));
        if (next.kind === "end") break;
        if (next.kind === "script") {
          file = next.file;
          queue.push(...next.then);
        } else {
          file = next.options[0]!.file;
          queue.push(...next.options[0]!.then);
        }
      }
      if (!(await runtime.loadScript(file, undefined, false))) {
        errors.push(`${current} : script suivant introuvable (${file})`);
        break;
      }
      current = file;
      played.push(file);
    }

    // Résumé chiffré, sans texte du jeu.
    // eslint-disable-next-line no-console
    console.log(`\nHistoire jouée : ${played.length} scripts, de ${played[0]} à ${played[played.length - 1]}\n`);

    expect(errors).toEqual([]);
    expect(stalled).toEqual([]);
    expect(played.length).toBeGreaterThanOrEqual(100);
    expect(played.slice(0, 3)).toEqual(["1-0.ks", "1-1.ks", "opening.ks"]);
    expect(played).toContain("teatime.ks");
    // Avec les timelines générées, l'ouverture est jouée (un arrêt timeline).
    if (timelines) expect(timelineStops).toBeGreaterThanOrEqual(1);
  });
});
