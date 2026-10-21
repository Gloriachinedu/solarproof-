#!/usr/bin/env node
/**
 * Translation coverage checker.
 *
 * Recursively compares the keys in messages/en.json (source) against
 * messages/es.json (target) and reports:
 *   - missing keys (present in EN, absent in ES)
 *   - extra keys   (present in ES, absent in EN)
 *
 * Exits non-zero when ES coverage is below 100%.
 *
 * Usage: node scripts/check-translations.mjs [--source en] [--target es]
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = resolve(__dirname, "..", "messages");

function parseArgs(argv) {
  const args = { source: "en", target: "es" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) {
      args.source = argv[++i];
    } else if (arg === "--target" && argv[i + 1]) {
      args.target = argv[++i];
    } else if (arg.startsWith("--source=")) {
      args.source = arg.slice("--source=".length);
    } else if (arg.startsWith("--target=")) {
      args.target = arg.slice("--target=".length);
    }
  }
  return args;
}

function loadJson(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Failed to read ${filePath}: ${err.message}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Recursively collect all leaf key paths from an object.
 * Leaf = any non-plain-object value (string, number, boolean, array, null).
 * Arrays are treated as leaves so their contents are not diffed key-by-key.
 */
function collectKeys(obj, prefix = "", out = new Set()) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out.add(prefix);
    return out;
  }
  const entries = Object.entries(obj);
  if (entries.length === 0 && prefix) {
    // Empty object — treat as a leaf so it is still tracked.
    out.add(prefix);
    return out;
  }
  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      collectKeys(value, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

function main() {
  const { source, target } = parseArgs(process.argv.slice(2));

  const sourcePath = resolve(MESSAGES_DIR, `${source}.json`);
  const targetPath = resolve(MESSAGES_DIR, `${target}.json`);

  const sourceJson = loadJson(sourcePath);
  const targetJson = loadJson(targetPath);

  const sourceKeys = collectKeys(sourceJson);
  const targetKeys = collectKeys(targetJson);

  const missing = [...sourceKeys].filter((k) => !targetKeys.has(k)).sort();
  const extra = [...targetKeys].filter((k) => !sourceKeys.has(k)).sort();

  const total = sourceKeys.size;
  const covered = total - missing.length;
  const coverage = total === 0 ? 100 : (covered / total) * 100;

  console.log(`Translation coverage check: ${source} -> ${target}`);
  console.log(`  Source keys (${source}): ${total}`);
  console.log(`  Target keys (${target}): ${targetKeys.size}`);
  console.log(`  Covered: ${covered}/${total} (${coverage.toFixed(2)}%)`);

  if (missing.length > 0) {
    console.log(`\nMissing keys in ${target}.json (${missing.length}):`);
    for (const key of missing) {
      console.log(`  - ${key}`);
    }
  }

  if (extra.length > 0) {
    console.log(`\nExtra keys in ${target}.json not present in ${source}.json (${extra.length}):`);
    for (const key of extra) {
      console.log(`  + ${key}`);
    }
  }

  if (missing.length === 0 && extra.length === 0) {
    console.log(`\n✓ ${target}.json is fully in sync with ${source}.json.`);
    process.exit(0);
  }

  if (coverage < 100) {
    console.error(
      `\n✗ Translation coverage for "${target}" is ${coverage.toFixed(2)}%, below the required 100%.`
    );
    process.exit(1);
  }

  // Coverage is 100% but there are extra keys — warn but do not fail.
  console.warn(
    `\n⚠ ${target}.json has extra keys not present in ${source}.json. Coverage is 100%.`
  );
  process.exit(0);
}

main();