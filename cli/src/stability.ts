import { mkdir, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";

import {
  AutomationConsole,
  createContactsApp,
  MemberRepository,
  ScenarioController,
  type AutomationRunView,
} from "@computer-use/contacts";

const runCount = parseRunCount(process.argv.slice(2));
const repository = new MemberRepository();
const scenarios = new ScenarioController();
const automation = new AutomationConsole(repository, scenarios);
const server = await listen(
  createContactsApp({ repository, scenarios, automation }),
);
const origin = serverOrigin(server);
const cases: StabilityCase[] = [
  {
    name: "update-phone-success",
    capabilityId: "contact.update-phone",
    expected: "success/SUCCESS",
    inputs: (iteration) => ({
      memberId: "M-1001",
      phone: `555-${String(300 + iteration).padStart(4, "0")}`,
    }),
    verify: (inputs) => repository.get("M-1001")?.phone === inputs.phone,
  },
  {
    name: "find-member-success",
    capabilityId: "contact.find-member",
    expected: "success/SUCCESS",
    inputs: () => ({ memberId: "M-1002" }),
    verify: () => repository.get("M-1002") !== undefined,
  },
  {
    name: "find-member-not-found",
    capabilityId: "contact.find-member",
    expected: "business_outcome/CONTACT_NOT_FOUND",
    inputs: () => ({ memberId: "M-9999" }),
    verify: () => repository.get("M-9999") === undefined,
  },
];

const caseReports: StabilityCaseReport[] = [];
try {
  for (const stabilityCase of cases) {
    const attempts: StabilityAttempt[] = [];
    for (let iteration = 1; iteration <= runCount; iteration += 1) {
      repository.reset();
      scenarios.reset();
      const inputs = stabilityCase.inputs(iteration);
      const startedAt = performance.now();
      let actual = "transport/UNKNOWN";
      let modelCallCount = -1;
      let stateVerified = false;
      let transportStatus = 0;
      try {
        const response = await fetch(
          `${origin}/api/capabilities/${stabilityCase.capabilityId}/invoke`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ inputs, scenario: "normal" }),
          },
        );
        transportStatus = response.status;
        const invocation = readInvocationResponse(await response.json());
        actual = `${invocation.result.resultKind}/${invocation.result.code}`;
        modelCallCount = invocation.modelCallCount;
        stateVerified = stabilityCase.verify(inputs);
      } catch (error) {
        actual = `transport/${error instanceof Error ? error.name : "ERROR"}`;
      }
      const durationMs = Math.round(performance.now() - startedAt);
      attempts.push({
        iteration,
        expected: stabilityCase.expected,
        actual,
        passed:
          transportStatus === 200 &&
          actual === stabilityCase.expected &&
          modelCallCount === 0 &&
          stateVerified,
        durationMs,
        transportStatus,
        modelCallCount,
        stateVerified,
      });
    }
    caseReports.push(summarizeCase(stabilityCase, attempts));
  }
} finally {
  await close(server);
}

const totalAttempts = caseReports.reduce(
  (total, report) => total + report.attempts,
  0,
);
const totalPassed = caseReports.reduce(
  (total, report) => total + report.passed,
  0,
);
const report = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  invocationSurface: "typed capability API",
  modelCallsPerReplay: 0,
  requestedRunsPerCase: runCount,
  overall: {
    attempts: totalAttempts,
    passed: totalPassed,
    passRate: ratio(totalPassed, totalAttempts),
    stable: caseReports.every((caseReport) => caseReport.stable),
    flaky: caseReports.some((caseReport) => caseReport.flaky),
  },
  cases: caseReports,
};
const reportPath = join(
  process.cwd(),
  "evidence",
  "generated",
  "stability-report.json",
);
await mkdir(join(process.cwd(), "evidence", "generated"), {
  recursive: true,
});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const caseReport of caseReports) {
  process.stdout.write(
    `${caseReport.stable ? "PASS" : "FAIL"} ${caseReport.name.padEnd(24)} ${caseReport.passed}/${caseReport.attempts} passRate=${formatPercent(caseReport.passRate)} flaky=${caseReport.flaky ? "yes" : "no"} p95=${caseReport.durationMs.p95}ms\n`,
  );
}
process.stdout.write(
  `${report.overall.stable ? "STABLE" : "UNSTABLE"} overall ${totalPassed}/${totalAttempts} passRate=${formatPercent(report.overall.passRate)} flaky=${report.overall.flaky ? "yes" : "no"}\n`,
);
process.stdout.write(`Report: ${relative(process.cwd(), reportPath)}\n`);
if (!report.overall.stable) process.exitCode = 1;

interface StabilityCase {
  name: string;
  capabilityId: "contact.update-phone" | "contact.find-member";
  expected: string;
  inputs: (iteration: number) => Record<string, string>;
  verify: (inputs: Record<string, string>) => boolean;
}

interface StabilityAttempt {
  iteration: number;
  expected: string;
  actual: string;
  passed: boolean;
  durationMs: number;
  transportStatus: number;
  modelCallCount: number;
  stateVerified: boolean;
}

interface StabilityCaseReport {
  name: string;
  capabilityId: string;
  expected: string;
  attempts: number;
  passed: number;
  passRate: number;
  stable: boolean;
  flaky: boolean;
  observedOutcomes: string[];
  durationMs: { median: number; p95: number };
  runs: StabilityAttempt[];
}

interface InvocationResponse {
  modelCallCount: number;
  result: Pick<AutomationRunView, "resultKind" | "code">;
}

function summarizeCase(
  stabilityCase: StabilityCase,
  attempts: StabilityAttempt[],
): StabilityCaseReport {
  const passed = attempts.filter((attempt) => attempt.passed).length;
  const observedOutcomes = [
    ...new Set(attempts.map((attempt) => attempt.actual)),
  ].sort();
  const durations = attempts
    .map((attempt) => attempt.durationMs)
    .sort((left, right) => left - right);
  return {
    name: stabilityCase.name,
    capabilityId: stabilityCase.capabilityId,
    expected: stabilityCase.expected,
    attempts: attempts.length,
    passed,
    passRate: ratio(passed, attempts.length),
    stable: passed === attempts.length && observedOutcomes.length === 1,
    flaky:
      observedOutcomes.length > 1 || (passed > 0 && passed < attempts.length),
    durationMs: {
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    observedOutcomes,
    runs: attempts,
  };
}

function readInvocationResponse(value: unknown): InvocationResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("modelCallCount" in value) ||
    typeof value.modelCallCount !== "number" ||
    !("result" in value) ||
    typeof value.result !== "object" ||
    value.result === null ||
    !("resultKind" in value.result) ||
    typeof value.result.resultKind !== "string" ||
    !("code" in value.result) ||
    typeof value.result.code !== "string"
  ) {
    throw new Error("The invocation endpoint returned an invalid response");
  }
  return value as InvocationResponse;
}

function parseRunCount(values: string[]): number {
  if (values.length === 0) return 5;
  if (values.length !== 2 || values[0] !== "--runs") {
    throw new Error("Usage: npm run stability -- --runs <2-25>");
  }
  const count = Number.parseInt(values[1] ?? "", 10);
  if (!Number.isInteger(count) || count < 2 || count > 25) {
    throw new Error("--runs must be an integer from 2 through 25");
  }
  return count;
}

function percentile(sortedValues: number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(sortedValues.length * quantile) - 1);
  return sortedValues[index] ?? 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function listen(
  app: ReturnType<typeof createContactsApp>,
): Promise<Server> {
  const activeServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    activeServer.once("listening", resolve);
    activeServer.once("error", reject);
  });
  return activeServer;
}

function serverOrigin(activeServer: Server): string {
  const address = activeServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the stability server to use a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(activeServer: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) =>
      error === undefined ? resolve() : reject(error),
    );
  });
}
