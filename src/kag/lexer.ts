/**
 * KAG3 lexer for Mahoyo PC 2012 scripts.
 *
 * Supports:
 * - Commands: @name key=value ...
 * - Inline tags: [name key=value], [l], [r], [p], [ruby text=...]
 * - Labels: *label|
 * - Comments: ; ...
 * - Plain text (Japanese + punctuation)
 */

import type { Token } from "./types.js";

function parseArgs(input: string): Record<string, string> {
  const args: Record<string, string> = {};
  const regex = /\s*([a-zA-Z0-9_-]+)=("([^"]*)"|'([^']*)'|([^\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    const key = match[1];
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    args[key] = value;
  }
  return args;
}

function tokenizeInlineTag(tagContent: string): Token {
  const trimmed = tagContent.trim();
  const spaceIndex = trimmed.search(/\s/);
  if (spaceIndex === -1) {
    return { type: "tag", name: trimmed, args: {} };
  }
  const name = trimmed.slice(0, spaceIndex);
  const rest = trimmed.slice(spaceIndex + 1);
  return { type: "tag", name, args: parseArgs(rest) };
}

function tokenizeLine(line: string): Token[] {
  const trimmed = line.trimEnd();
  const stripped = trimmed.trimStart();

  if (stripped.length === 0) return [];

  // Comment line
  if (stripped.startsWith(";")) {
    return [{ type: "comment", content: stripped.slice(1).trim() }];
  }

  // Label
  const labelMatch = stripped.match(/^\*([^\s|]+)\|?/);
  if (labelMatch) {
    return [{ type: "label", name: labelMatch[1] }];
  }

  // Command
  if (stripped.startsWith("@")) {
    const content = stripped.slice(1);
    const spaceIndex = content.search(/\s/);
    let name: string;
    let rest = "";
    if (spaceIndex === -1) {
      name = content;
    } else {
      name = content.slice(0, spaceIndex);
      rest = content.slice(spaceIndex + 1);
    }
    return [{ type: "command", name, args: parseArgs(rest) }];
  }

  // Plain text with optional inline tags
  const tokens: Token[] = [];
  const regex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: "text",
        content: stripped.slice(lastIndex, match.index),
      });
    }
    tokens.push(tokenizeInlineTag(match[1]));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < stripped.length) {
    tokens.push({ type: "text", content: stripped.slice(lastIndex) });
  }

  return tokens;
}

export function lex(input: string): Token[] {
  const lines = input.split(/\r?\n/);
  const tokens: Token[] = [];
  let inScript = false;
  for (const line of lines) {
    const stripped = line.trimStart();
    if (inScript) {
      if (stripped.startsWith("@endscript")) {
        inScript = false;
        tokens.push({ type: "command", name: "endscript", args: {} });
      }
      // Sinon, ignorer la ligne JS
      tokens.push({ type: "linebreak" });
      continue;
    }
    if (stripped.startsWith("@iscript")) {
      inScript = true;
      tokens.push({ type: "command", name: "iscript", args: {} });
      tokens.push({ type: "linebreak" });
      continue;
    }
    const lineTokens = tokenizeLine(line);
    tokens.push(...lineTokens);
    tokens.push({ type: "linebreak" });
  }
  if (inScript) {
    console.warn("[lexer] @iscript sans @endscript correspondant");
  }
  return tokens;
}
