import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { SCHEMA_VERSION } from "@computer-use/contracts";
import { z } from "zod";

export const EvidenceManifestEntrySchema = z.strictObject({
  path: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  redaction: z.enum(["structured", "pixel-masked"]),
});

export const EvidenceManifestSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  files: z.array(EvidenceManifestEntrySchema),
});

export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
export type EvidenceManifestEntry = z.infer<typeof EvidenceManifestEntrySchema>;

export interface EvidenceVerification {
  valid: boolean;
  errors: string[];
  manifest?: EvidenceManifest;
}

export async function describeEvidenceFile(
  rootDirectory: string,
  relativePath: string,
  mediaType: string,
  redaction: EvidenceManifestEntry["redaction"],
): Promise<EvidenceManifestEntry> {
  const filePath = safeEvidencePath(rootDirectory, relativePath);
  const [contents, metadata] = await Promise.all([
    readFile(filePath),
    stat(filePath),
  ]);
  return {
    path: relativePath,
    mediaType,
    bytes: metadata.size,
    sha256: sha256(contents),
    redaction,
  };
}

export async function verifyEvidencePackage(
  rootDirectory: string,
): Promise<EvidenceVerification> {
  let parsed: EvidenceManifest;
  try {
    const manifestText = await readFile(
      safeEvidencePath(rootDirectory, "manifest.json"),
      "utf8",
    );
    parsed = EvidenceManifestSchema.parse(JSON.parse(manifestText) as unknown);
  } catch {
    return { valid: false, errors: ["Manifest is missing or invalid"] };
  }

  const errors: string[] = [];
  const paths = parsed.files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) {
    errors.push("Manifest contains duplicate file paths");
  }

  for (const entry of parsed.files) {
    try {
      const actual = await describeEvidenceFile(
        rootDirectory,
        entry.path,
        entry.mediaType,
        entry.redaction,
      );
      if (actual.bytes !== entry.bytes) {
        errors.push(`Size mismatch for ${entry.path}`);
      }
      if (actual.sha256 !== entry.sha256) {
        errors.push(`Digest mismatch for ${entry.path}`);
      }
    } catch {
      errors.push(`Missing or unsafe evidence file ${entry.path}`);
    }
  }

  return { valid: errors.length === 0, errors, manifest: parsed };
}

export function safeEvidencePath(
  rootDirectory: string,
  relativePath: string,
): string {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    throw new Error("Evidence paths must be non-empty and relative");
  }
  const root = resolve(rootDirectory);
  const destination = resolve(root, relativePath);
  const withinRoot = relative(root, destination);
  if (
    withinRoot === "" ||
    withinRoot === ".." ||
    withinRoot.startsWith(`..${sep}`) ||
    isAbsolute(withinRoot)
  ) {
    throw new Error("Evidence path escapes the package root");
  }
  return destination;
}

function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
