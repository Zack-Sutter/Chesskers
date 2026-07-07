import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFixture, fixtureToJson, goldenFixtures } from "../src/goldenFixtures.ts";

const rootFixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

mkdirSync(rootFixtures, { recursive: true });

for (const fixture of goldenFixtures) {
  assertFixture(fixture);
  const path = join(rootFixtures, `${fixture.name}.json`);
  writeFileSync(path, `${JSON.stringify(fixtureToJson(fixture), null, 2)}\n`);
}

console.log(`Wrote ${goldenFixtures.length} fixtures to ${rootFixtures}`);
