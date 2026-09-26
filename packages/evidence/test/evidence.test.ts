import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EvidencePackageWriter,
  PrivacyGateway,
  verifyEvidencePackage,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe("PrivacyGateway", () => {
  it("redacts sensitive keys and sensitive text patterns recursively", () => {
    const gateway = new PrivacyGateway({ redactEmails: true });
    const syntheticSensitiveValue = ["123", "45", "6789"].join("-");
    const syntheticApiKey = ["sk", "testonlyvalue000000000000"].join("-");

    const sanitized = gateway.sanitize({
      nested: {
        ssn: syntheticSensitiveValue,
        note: `Do not persist ${syntheticSensitiveValue}`,
        apiKey: syntheticApiKey,
        email: "synthetic.user@example.test",
      },
    });
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(syntheticSensitiveValue);
    expect(serialized).not.toContain(syntheticApiKey);
    expect(serialized).not.toContain("synthetic.user@example.test");
    expect(serialized).toContain("[REDACTED:SSN]");
  });
});

describe("EvidencePackageWriter", () => {
  it("writes an append-only, verifiable, redacted evidence package", async () => {
    const directory = await createTemporaryDirectory();
    const writer = new EvidencePackageWriter(directory, "run-001", {
      now: () => new Date("2026-09-25T18:00:00Z"),
    });
    const syntheticSensitiveValue = ["123", "45", "6789"].join("-");
    await writer.initialize();
    await writer.appendEvent({
      schemaVersion: "1.0.0",
      eventId: "event-001",
      runId: "run-001",
      sequence: 0,
      timestamp: "2026-09-25T18:00:00Z",
      type: "run_started",
      mode: "replay",
      capabilityId: "contact.update-phone",
    });
    await writer.writeJsonArtifact("artifacts/observation.json", {
      page: "contact-edit",
      ssn: syntheticSensitiveValue,
      text: `Detected ${syntheticSensitiveValue}`,
    });
    await writer.writeMaskedScreenshot("screenshots/failure.png", {
      bytes: Buffer.from("synthetic-masked-image"),
      maskedRegions: 1,
    });
    const manifest = await writer.finalize();

    expect(manifest.files).toHaveLength(3);
    expect((await verifyEvidencePackage(directory)).valid).toBe(true);
    const artifact = await readFile(
      join(directory, "artifacts/observation.json"),
      "utf8",
    );
    expect(artifact).not.toContain(syntheticSensitiveValue);
    await expect(
      writer.writeJsonArtifact("artifacts/late.json", { tooLate: true }),
    ).rejects.toThrow("immutable");
  });

  it("detects evidence modified after finalization", async () => {
    const directory = await createTemporaryDirectory();
    const writer = new EvidencePackageWriter(directory, "run-002");
    await writer.initialize();
    await writer.writeJsonArtifact("result.json", { kind: "success" });
    await writer.finalize();

    await appendFile(join(directory, "result.json"), "modified", "utf8");
    const verification = await verifyEvidencePackage(directory);

    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain("Digest mismatch for result.json");
  });

  it("rejects unmasked screenshots and path traversal", async () => {
    const directory = await createTemporaryDirectory();
    const writer = new EvidencePackageWriter(directory, "run-003");
    await writer.initialize();

    await expect(
      writer.writeMaskedScreenshot("screenshots/unmasked.png", {
        bytes: Buffer.from("unmasked"),
        maskedRegions: 0,
      }),
    ).rejects.toThrow("privacy mask");
    await expect(
      writer.writeJsonArtifact("../outside.json", { unsafe: true }),
    ).rejects.toThrow("escapes");
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "computer-use-evidence-"));
  temporaryDirectories.push(directory);
  return directory;
}
