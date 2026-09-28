import type { Action, ExecutionPolicy } from "@computer-use/contracts";

import type { DiscoveryInput } from "./types.js";

const protectedValuePattern =
  /(?:\b\d{3}[- ]?\d{2}[- ]?\d{4}\b|\b(?:password|api key|access token|private key)\s*[:=]\s*\S+)/i;
const sensitiveIntentPattern =
  /\b(?:ssn|social security|password|api key|access token|private key)\b/i;
const sensitiveTargetPattern =
  /\b(?:ssn|social security|password|secret|token|private key)\b/i;

export class DiscoveryPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryPolicyError";
  }
}

export function discoveryInterventionReason(goal: string): string | undefined {
  if (sensitiveIntentPattern.test(goal) && !protectedValuePattern.test(goal)) {
    return "SENSITIVE_DATA_ENTRY_REQUIRED";
  }
  return undefined;
}

export function assertDiscoveryRequestSafe(
  goal: string,
  inputs: Readonly<Record<string, DiscoveryInput>>,
  policy: ExecutionPolicy,
): void {
  if (protectedValuePattern.test(goal)) {
    throw new DiscoveryPolicyError(
      "SENSITIVE_GOAL_BLOCKED",
      "The discovery goal contains a protected value",
    );
  }

  for (const [name, input] of Object.entries(inputs)) {
    if (policy.blockedDataClasses.includes(input.dataClass)) {
      throw new DiscoveryPolicyError(
        "SENSITIVE_INPUT_BLOCKED",
        `Input ${name} belongs to a blocked data class`,
      );
    }
  }
}

export function assertActionAuthorized(
  action: Action,
  inputs: Readonly<Record<string, DiscoveryInput>>,
  policy: ExecutionPolicy,
): void {
  if (!policy.allowedActions.includes(action.type)) {
    throw new DiscoveryPolicyError(
      "ACTION_NOT_ALLOWED",
      `Action ${action.type} is not allowed during discovery`,
    );
  }

  if (action.type !== "fill" && action.type !== "select") return;
  const targetText = action.target.strategies
    .map((strategy) =>
      strategy.type === "label"
        ? strategy.label
        : strategy.type === "role"
          ? strategy.name
          : strategy.type === "text"
            ? strategy.text
            : strategy.selector,
    )
    .join(" ");
  if (sensitiveTargetPattern.test(targetText)) {
    throw new DiscoveryPolicyError(
      "SENSITIVE_TARGET_BLOCKED",
      "Discovery cannot enter data into a sensitive control",
    );
  }
  if (action.value.kind === "input") {
    const input = inputs[action.value.name];
    if (input === undefined) {
      throw new DiscoveryPolicyError(
        "UNKNOWN_INPUT",
        `The model referenced undeclared input ${action.value.name}`,
      );
    }
    if (policy.blockedDataClasses.includes(input.dataClass)) {
      throw new DiscoveryPolicyError(
        "SENSITIVE_INPUT_BLOCKED",
        `Input ${action.value.name} belongs to a blocked data class`,
      );
    }
  }
}
