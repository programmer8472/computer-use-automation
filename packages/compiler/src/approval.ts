import { createHash } from "node:crypto";

import {
  CapabilityPackageSchema,
  type CapabilityPackage,
} from "@computer-use/contracts";

export type ApprovalVerification =
  | { valid: true; capability: CapabilityPackage }
  | { valid: false; reason: string };

export function approveCapability(
  input: unknown,
  approvedBy: string,
  approvedAt = new Date(),
): CapabilityPackage {
  const capability = CapabilityPackageSchema.parse(input);
  if (capability.approval.status !== "draft") {
    throw new Error("Only a draft capability can be approved");
  }
  const withoutDigest = {
    ...capability,
    approval: {
      status: "approved" as const,
      approvedBy,
      approvedAt: approvedAt.toISOString(),
    },
  };
  const digest = digestCapability(withoutDigest);
  return CapabilityPackageSchema.parse({
    ...withoutDigest,
    approval: { ...withoutDigest.approval, digest },
  });
}

export function verifyApprovedCapability(input: unknown): ApprovalVerification {
  const parsed = CapabilityPackageSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, reason: "Capability schema validation failed" };
  }
  const capability = parsed.data;
  if (capability.approval.status !== "approved") {
    return { valid: false, reason: "Capability is not approved" };
  }
  const { digest, ...approvalWithoutDigest } = capability.approval;
  const expected = digestCapability({
    ...capability,
    approval: approvalWithoutDigest,
  });
  if (digest !== expected) {
    return {
      valid: false,
      reason: "Capability content no longer matches its approval digest",
    };
  }
  return { valid: true, capability };
}

function digestCapability(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}
