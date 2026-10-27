/**
 * Gabarits de commandes pour les outils externes (ffmpeg, tlg converter, etc.).
 *
 * Au lieu de passer des arguments bruts, on utilise des gabarits avec
 * des placeholders `{in}` et `{out}` qui sont substitués argument par argument.
 * Le gabarit est découpé en argv (gestion des guillemets) puis exécuté via
 * execFile sans shell — indispensable avec des noms comme 山城01(近).
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { access } from "fs/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Découpe une chaîne de commande en argv, en gérant les guillemets simples
 * et doubles. Ex: `ffmpeg -y -i "input file.ogg" out.ogg` →
 * ["ffmpeg", "-y", "-i", "input file.ogg", "out.ogg"]
 */
export function splitCommand(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < template.length; i++) {
    const ch = template[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) args.push(current);
  return args;
}

/**
 * Substitue {in} et {out} dans chaque argument d'un argv.
 */
export function substituteArgs(argv: string[], input: string, output: string): string[] {
  return argv.map((arg) => arg.replace(/\{in\}/g, input).replace(/\{out\}/g, output));
}

/**
 * Vérifie qu'un gabarit contient les placeholders requis et que l'exécutable
 * existe. Retourne un message d'erreur ou null si OK.
 */
export function validateCommandTemplate(template: string, requiresIn: boolean, requiresOut: boolean): string | null {
  const argv = splitCommand(template);
  if (argv.length === 0) return "gabarit vide";

  const exe = argv[0];
  if (!exe) return "exécutable manquant";

  // Vérifier que l'exécutable existe (chemin absolu) ou est dans le PATH.
  if (exe.includes("/") || exe.includes("\\")) {
    if (!existsSync(exe)) return `exécutable introuvable: ${exe}`;
  } else {
    // Pour les commandes du PATH, on ne peut pas toujours vérifier.
    // On laisse execFile échouer plus tard avec un message clair.
  }

  const joined = template;
  if (requiresIn && !joined.includes("{in}")) return "placeholder {in} manquant";
  if (requiresOut && !joined.includes("{out}")) return "placeholder {out} manquant";

  return null;
}

/**
 * Exécute une commande externe avec substitution de placeholders.
 * @throws en cas d'échec (code de sortie non nul ou exécutable introuvable)
 */
export async function runCommand(
  template: string,
  input: string,
  output: string,
): Promise<void> {
  const argv = splitCommand(template);
  const finalArgs = substituteArgs(argv, input, output);
  const exe = finalArgs[0];
  const args = finalArgs.slice(1);

  await execFileAsync(exe, args, {
    maxBuffer: 10 * 1024 * 1024,
  });
}
