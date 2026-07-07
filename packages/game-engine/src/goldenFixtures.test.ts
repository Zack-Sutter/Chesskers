import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertFixture, fixtureToJson, goldenFixtures } from "./goldenFixtures";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures"
);

describe("goldenFixtures", () => {
  for (const fixture of goldenFixtures) {
    it(fixture.name, () => {
      assertFixture(fixture);
    });
  }

  it("exported JSON on disk matches definitions", () => {
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(goldenFixtures.length);

    for (const fixture of goldenFixtures) {
      const path = join(fixturesDir, `${fixture.name}.json`);
      const onDisk = JSON.parse(readFileSync(path, "utf8"));
      expect(onDisk).toEqual(fixtureToJson(fixture));
    }
  });
});
