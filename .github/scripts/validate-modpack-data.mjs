#!/usr/bin/env node
// Validates that each given modpack_data JSON file contains all required
// top-level keys. The data files are huge, so this streams the file and
// detects top-level keys without loading the whole document into memory.

import fs from "node:fs";

const REQUIRED_KEYS = [
  "item_names",
  "recipe_data",
  "item_tags",
  "fluid_tags",
  "item_nbt",
];

/**
 * Streams a JSON file and returns the set of keys found directly on the root
 * object. Values (which can be enormous) are skipped, not parsed. Stops early
 * once every required key has been seen.
 *
 * @param {string} filePath
 * @returns {Promise<Set<string>>}
 */
function findTopLevelKeys(filePath) {
  return new Promise((resolve, reject) => {
    const keys = new Set();

    let depth = 0; // nesting level of {} / []
    let inString = false;
    let escaped = false;
    let stringChars = null; // chars of the string currently being read
    let stringDepth = 0; // depth at which the current string started
    let candidate = null; // a string read at depth 1, awaiting a ':' to confirm key
    let sawRootOpen = false;

    const stream = fs.createReadStream(filePath, { encoding: "utf8" });

    const finish = () => {
      stream.destroy();
      resolve(keys);
    };

    stream.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];

        if (inString) {
          if (escaped) {
            escaped = false;
            stringChars.push(c);
          } else if (c === "\\") {
            escaped = true;
          } else if (c === '"') {
            inString = false;
            const value = stringChars.join("");
            stringChars = null;
            // A string at depth 1 is a candidate key; confirmed if the next
            // significant char is ':'. Otherwise it's a string value.
            if (stringDepth === 1) candidate = value;
          } else {
            stringChars.push(c);
          }
          continue;
        }

        // Not inside a string.
        if (candidate !== null && c !== " " && c !== "\t" && c !== "\n" && c !== "\r") {
          if (c === ":") {
            keys.add(candidate);
            candidate = null;
            if (REQUIRED_KEYS.every((k) => keys.has(k))) {
              finish();
              return;
            }
            continue;
          }
          // The string was a value, not a key.
          candidate = null;
        }

        if (c === '"') {
          inString = true;
          escaped = false;
          stringChars = [];
          stringDepth = depth;
        } else if (c === "{" || c === "[") {
          if (!sawRootOpen) sawRootOpen = true;
          depth++;
        } else if (c === "}" || c === "]") {
          depth--;
        }
      }
    });

    stream.on("error", reject);
    stream.on("close", () => resolve(keys));
    stream.on("end", finish);
  });
}

async function main() {
  const files = process.argv.slice(2).filter(Boolean);
  if (files.length === 0) {
    console.log("No modpack_data JSON files to validate.");
    return;
  }

  let failed = false;

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`::error file=${file}::File not found: ${file}`);
      failed = true;
      continue;
    }

    let keys;
    try {
      keys = await findTopLevelKeys(file);
    } catch (err) {
      console.error(`::error file=${file}::Failed to read ${file}: ${err.message}`);
      failed = true;
      continue;
    }

    const missing = REQUIRED_KEYS.filter((k) => !keys.has(k));
    if (missing.length > 0) {
      console.error(
        `::error file=${file}::${file} is missing required top-level key(s): ${missing.join(", ")}`
      );
      failed = true;
    } else {
      console.log(`✓ ${file} contains all required top-level keys.`);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
