import type {
  Action,
  ExecutionPolicy,
  TargetLocator,
} from "@computer-use/contracts";

export interface ResolvedControlFacts {
  target: TargetLocator;
  strategyIndex: number;
  tag: string;
  role: string | undefined;
  name: string;
  inputType: string | undefined;
  href: string | undefined;
}

export class PolicyDeniedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyDeniedError";
  }
}

export function intersectPolicies(
  artifact: ExecutionPolicy,
  runtime: ExecutionPolicy,
): ExecutionPolicy {
  return {
    allowedOrigins: artifact.allowedOrigins.filter((value) =>
      runtime.allowedOrigins.includes(value),
    ),
    allowedRoutes: artifact.allowedRoutes.filter((value) =>
      runtime.allowedRoutes.includes(value),
    ),
    allowedActions: artifact.allowedActions.filter((value) =>
      runtime.allowedActions.includes(value),
    ),
    blockedDataClasses: [
      ...new Set([
        ...artifact.blockedDataClasses,
        ...runtime.blockedDataClasses,
      ]),
    ],
    maximumRecoveryAttempts: Math.min(
      artifact.maximumRecoveryAttempts,
      runtime.maximumRecoveryAttempts,
    ),
    requiredApprovals: deduplicateApprovals([
      ...artifact.requiredApprovals,
      ...runtime.requiredApprovals,
    ]),
  };
}

export function authorizeResolvedAction(
  action: Action,
  control: ResolvedControlFacts,
  effectivePolicy: ExecutionPolicy,
): void {
  if (!effectivePolicy.allowedActions.includes(action.type)) {
    throw new PolicyDeniedError(
      "ACTION_NOT_ALLOWED",
      `Action ${action.type} is outside effective authority`,
    );
  }

  const sensitiveSemantics = `${control.name} ${control.inputType ?? ""}`;
  if (
    control.inputType === "password" ||
    /\b(?:ssn|social security|password|secret|token|private key)\b/i.test(
      sensitiveSemantics,
    )
  ) {
    throw new PolicyDeniedError(
      "SENSITIVE_CONTROL_BLOCKED",
      "Automation cannot interact with a sensitive control",
    );
  }

  if (control.href !== undefined) {
    const url = new URL(control.href);
    if (!effectivePolicy.allowedOrigins.includes(url.origin)) {
      throw new PolicyDeniedError(
        "ORIGIN_NOT_ALLOWED",
        `Resolved destination origin ${url.origin} is not allowed`,
      );
    }
    if (
      !effectivePolicy.allowedRoutes.some((pattern) =>
        matches(url.pathname, pattern),
      )
    ) {
      throw new PolicyDeniedError(
        "ROUTE_NOT_ALLOWED",
        `Resolved destination route ${url.pathname} is not allowed`,
      );
    }
  }
}

function deduplicateApprovals(
  approvals: ExecutionPolicy["requiredApprovals"],
): ExecutionPolicy["requiredApprovals"] {
  return approvals.filter(
    (approval, index) =>
      approvals.findIndex(
        (candidate) =>
          candidate.risk === approval.risk &&
          candidate.authority === approval.authority,
      ) === index,
  );
}

function matches(value: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
}
