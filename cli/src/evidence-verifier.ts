import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { verifyEvidencePackage } from "@computer-use/evidence";

export interface SubmissionEvidenceVerification {
  valid: boolean;
  packages: string[];
  errors: string[];
}

const requiredPackages = [
  "discovery-live",
  "demo/ambiguous-target",
  "demo/handoff",
  "demo/matrix",
  "demo/missing-contact",
  "demo/replay-narrow",
  "demo/replay-tablet",
  "demo/replay-wide",
  "demo/transient-recovery",
];

const prohibitedTextPatterns: readonly [RegExp, string][] = [
  [/\b[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{4}\b/, "SSN-like value"],
  [/\bsk-[a-zA-Z0-9_-]{16,}\b/, "API-key-like value"],
  [/\bBearer\s+[a-zA-Z0-9._~-]{12,}\b/i, "bearer token"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email address"],
];

export async function verifySubmissionEvidence(
  rootDirectory: string,
): Promise<SubmissionEvidenceVerification> {
  const manifestDirectories = await findManifestDirectories(rootDirectory);
  const packages = manifestDirectories
    .map((directory) => relative(rootDirectory, directory))
    .sort();
  const errors: string[] = [];

  for (const required of requiredPackages) {
    if (!packages.includes(required)) {
      errors.push(`Missing required evidence package ${required}`);
    }
  }

  for (const directory of manifestDirectories) {
    const packageName = relative(rootDirectory, directory);
    const verification = await verifyEvidencePackage(directory);
    if (!verification.valid) {
      errors.push(
        ...verification.errors.map((error) => `${packageName}: ${error}`),
      );
      continue;
    }
    for (const entry of verification.manifest?.files ?? []) {
      if (!isTextMediaType(entry.mediaType)) continue;
      const contents = await readFile(join(directory, entry.path), "utf8");
      for (const [pattern, description] of prohibitedTextPatterns) {
        if (pattern.test(contents)) {
          errors.push(
            `${packageName}/${entry.path}: contains prohibited ${description}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, packages, errors };
}

async function findManifestDirectories(
  rootDirectory: string,
): Promise<string[]> {
  const directories: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (
      entries.some((entry) => entry.isFile() && entry.name === "manifest.json")
    ) {
      directories.push(directory);
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => visit(join(directory, entry.name))),
    );
  }

  try {
    await visit(rootDirectory);
  } catch (error) {
    if (isMissingPath(error)) {
      return [];
    }
    throw error;
  }
  return directories;
}

function isTextMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("application/json") ||
    mediaType === "application/x-ndjson" ||
    mediaType.startsWith("text/")
  );
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
