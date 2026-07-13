#!/usr/bin/env node
/**
 * Schema validation gate.
 *
 * Compiles the current runtime-event JSON Schema and validates every fixture in
 * `schemas/examples/` against it. Exits non-zero on any violation so CI fails
 * when the schema and its documented examples drift apart.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const schemasDir = join(root, "schemas");
const examplesDir = join(schemasDir, "examples");

const CURRENT_SCHEMA = "runtime-event.v2.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const schema = readJson(join(schemasDir, CURRENT_SCHEMA));
  const validate = ajv.compile(schema);

  const fixtures = readdirSync(examplesDir).filter((name) => name.endsWith(".json"));
  if (fixtures.length === 0) {
    console.error("✖ no example fixtures found in schemas/examples/");
    process.exit(1);
  }

  let failures = 0;
  for (const fixture of fixtures.sort()) {
    const data = readJson(join(examplesDir, fixture));
    const ok = validate(data);
    if (ok) {
      console.log(`✔ ${fixture}`);
    } else {
      failures += 1;
      console.error(`✖ ${fixture}`);
      for (const err of validate.errors ?? []) {
        console.error(`    ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} fixture(s) failed validation against ${CURRENT_SCHEMA}.`);
    process.exit(1);
  }
  console.log(`\nAll ${fixtures.length} fixtures valid against ${CURRENT_SCHEMA}.`);
}

main();
