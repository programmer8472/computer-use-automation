import { mkdir, open, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  EvidenceEventSchema,
  SCHEMA_VERSION,
  type EvidenceEvent,
} from "@computer-use/contracts";

import {
  describeEvidenceFile,
  EvidenceManifestSchema,
  safeEvidencePath,
  type EvidenceManifest,
  type EvidenceManifestEntry,
} from "./manifest.js";
import { PrivacyGateway } from "./privacy.js";

interface TrackedEvidence {
  path: string;
  mediaType: string;
  redaction: EvidenceManifestEntry["redaction"];
}

export interface MaskedScreenshot {
  bytes: Buffer;
  maskedRegions: number;
}

export interface EvidencePackageWriterOptions {
  privacyGateway?: PrivacyGateway;
  now?: () => Date;
}

export class EvidencePackageWriter {
  readonly #privacyGateway: PrivacyGateway;
  readonly #now: () => Date;
  readonly #tracked = new Map<string, TrackedEvidence>();
  #initialized = false;
  #finalized = false;

  constructor(
    readonly rootDirectory: string,
    readonly runId: string,
    options: EvidencePackageWriterOptions = {},
  ) {
    this.#privacyGateway = options.privacyGateway ?? new PrivacyGateway();
    this.#now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.rootDirectory, { recursive: true });
    const existing = await readdir(this.rootDirectory);
    if (existing.length > 0) {
      throw new Error("Evidence package directory must be empty");
    }
    this.#initialized = true;
  }

  async appendEvent(event: EvidenceEvent): Promise<void> {
    this.assertWritable();
    const sanitized = this.#privacyGateway.sanitize(event);
    const validated = EvidenceEventSchema.parse(sanitized);
    const relativePath = "events.jsonl";
    const destination = safeEvidencePath(this.rootDirectory, relativePath);
    const handle = await open(destination, "a");
    try {
      await handle.writeFile(`${JSON.stringify(validated)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    this.#track(relativePath, "application/x-ndjson", "structured");
  }

  async writeJsonArtifact(
    relativePath: string,
    value: unknown,
  ): Promise<string> {
    this.assertWritable();
    if (!relativePath.endsWith(".json")) {
      throw new Error(
        "Structured evidence artifacts must use a .json extension",
      );
    }
    const destination = safeEvidencePath(this.rootDirectory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    const sanitized = this.#privacyGateway.sanitize(value);
    await writeFile(destination, `${JSON.stringify(sanitized, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    this.#track(relativePath, "application/json", "structured");
    return relativePath;
  }

  async writeMaskedScreenshot(
    relativePath: string,
    screenshot: MaskedScreenshot,
  ): Promise<string> {
    this.assertWritable();
    if (!relativePath.endsWith(".png")) {
      throw new Error("Screenshot evidence must use a .png extension");
    }
    if (screenshot.maskedRegions < 1) {
      throw new Error(
        "Screenshot evidence requires at least one applied privacy mask",
      );
    }
    const destination = safeEvidencePath(this.rootDirectory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, screenshot.bytes, { flag: "wx" });
    this.#track(relativePath, "image/png", "pixel-masked");
    return relativePath;
  }

  async finalize(): Promise<EvidenceManifest> {
    this.assertWritable();
    const files = await Promise.all(
      [...this.#tracked.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map(async (entry) =>
          describeEvidenceFile(
            this.rootDirectory,
            entry.path,
            entry.mediaType,
            entry.redaction,
          ),
        ),
    );
    const manifest = EvidenceManifestSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      runId: this.runId,
      createdAt: this.#now().toISOString(),
      files,
    });
    await writeFile(
      safeEvidencePath(this.rootDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    this.#finalized = true;
    return manifest;
  }

  assertWritable(): void {
    if (!this.#initialized) {
      throw new Error("Evidence writer must be initialized before use");
    }
    if (this.#finalized) {
      throw new Error("Finalized evidence packages are immutable");
    }
  }

  #track(
    path: string,
    mediaType: string,
    redaction: EvidenceManifestEntry["redaction"],
  ): void {
    this.#tracked.set(path, { path, mediaType, redaction });
  }
}
