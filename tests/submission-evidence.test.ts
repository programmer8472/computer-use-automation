import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifySubmissionEvidence } from "../cli/src/evidence-verifier.js";

describe("committed submission evidence", () => {
  it("contains every required package with valid digests and no raw sensitive patterns", async () => {
    const verification = await verifySubmissionEvidence(
      join(process.cwd(), "evidence", "submission"),
    );

    expect(verification.errors).toEqual([]);
    expect(verification.valid).toBe(true);
    expect(verification.packages).toHaveLength(9);
  });
});
