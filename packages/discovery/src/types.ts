import type {
  Action,
  ExecutionPolicy,
  TargetLocator,
} from "@computer-use/contracts";
import type { SurfaceObservation } from "@computer-use/surface-playwright";

export type DiscoveryDataClass =
  "public" | "personal" | "sensitive" | "credential" | "full_ssn";

export interface DiscoveryInput {
  value: string;
  dataClass: DiscoveryDataClass;
  description: string;
}

export interface ModelToolResult {
  callId: string;
  output: Record<string, unknown>;
}

export interface ModelTurn {
  goal: string;
  inputs: Readonly<Record<string, DiscoveryInput>>;
  observation: SurfaceObservation;
  previousToolResult?: ModelToolResult;
}

export interface ModelToolCall {
  callId: string;
  name: string;
  arguments: unknown;
}

export interface ModelTurnResult {
  responseId: string;
  toolCalls: ModelToolCall[];
  outputText: string;
}

export interface DiscoveryModel {
  nextTurn(turn: ModelTurn): Promise<ModelTurnResult>;
}

export interface RecordedDiscoveryStep {
  id: string;
  observationBeforeRef: string;
  observationBeforeDigest: string;
  action: Action;
  resolvedStrategyIndex: number;
  observationAfterRef: string;
  observationAfterDigest: string;
}

export interface DiscoveryTrace {
  schemaVersion: "1.0.0";
  runId: string;
  goal: string;
  modelCallCount: number;
  steps: RecordedDiscoveryStep[];
}

export interface DiscoveryRunRequest {
  runId: string;
  goal: string;
  startUrl: string;
  inputs: Readonly<Record<string, DiscoveryInput>>;
  policy: ExecutionPolicy;
  maximumModelCalls?: number;
  verifySuccess: () => Promise<boolean>;
}

export type DiscoveryRunResult =
  | {
      kind: "success";
      runId: string;
      modelCallCount: number;
      trace: DiscoveryTrace;
    }
  | {
      kind: "pending_escalation";
      runId: string;
      modelCallCount: number;
      reasonCode: string;
    }
  | {
      kind: "hard_failure";
      runId: string;
      modelCallCount: number;
      code: string;
      message: string;
    };

export interface ObservationRecord {
  observation: SurfaceObservation;
  artifactRef: string;
  digest: string;
}

export interface DiscoveryActionDecision {
  callId: string;
  action: Action;
  target: TargetLocator;
}
