import type {
  Action,
  Check,
  ExecutionPolicy,
  TargetLocator,
  TerminalResult,
} from "@computer-use/contracts";
import type {
  ActionResult,
  SurfaceObservation,
  SurfaceTargetInspection,
} from "@computer-use/surface-playwright";
import type { EvidencePackageWriter } from "@computer-use/evidence";

export interface ReplaySurface {
  act(
    action: Action,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<ActionResult>;
  check(check: Check): Promise<boolean>;
  settle(checks: readonly Check[], timeoutMs: number): Promise<void>;
  observe(): Promise<SurfaceObservation>;
  inspectTarget(target: TargetLocator): Promise<SurfaceTargetInspection>;
  assertUrlAllowed(value: string): void;
}

export interface ReplayRequest {
  runId: string;
  capability: unknown;
  inputs: Readonly<Record<string, unknown>>;
  startUrl: string;
}

export interface ReplayExecutorOptions {
  surface: ReplaySurface;
  runtimePolicy: ExecutionPolicy;
  evidence?: EvidencePackageWriter;
  now?: () => Date;
}

export type ReplayResult = TerminalResult;
