import { access } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workspaceManifests = [
  "apps/contacts/package.json",
  "apps/operator/package.json",
  "cli/package.json",
  "packages/compiler/package.json",
  "packages/contracts/package.json",
  "packages/discovery/package.json",
  "packages/evidence/package.json",
  "packages/policy/package.json",
  "packages/replay/package.json",
  "packages/session/package.json",
  "packages/surface-playwright/package.json",
];

describe("workspace foundation", () => {
  it.each(workspaceManifests)("includes %s", async (manifest) => {
    await expect(
      access(join(process.cwd(), manifest)),
    ).resolves.toBeUndefined();
  });
});
