export const scenarioNames = [
  "normal",
  "ambiguous-actions",
  "transient-search",
  "unexpected-dialog",
] as const;

export type ScenarioName = (typeof scenarioNames)[number];

export class ScenarioController {
  #active: ScenarioName = "normal";
  #transientSearchFailuresRemaining = 0;

  get active(): ScenarioName {
    return this.#active;
  }

  set(scenario: ScenarioName): void {
    this.#active = scenario;
    this.#transientSearchFailuresRemaining =
      scenario === "transient-search" ? 1 : 0;
  }

  reset(): void {
    this.set("normal");
  }

  dismissDialog(): void {
    if (this.#active === "unexpected-dialog") {
      this.set("normal");
    }
  }

  consumeTransientSearchFailure(): boolean {
    if (
      this.#active !== "transient-search" ||
      this.#transientSearchFailuresRemaining === 0
    ) {
      return false;
    }
    this.#transientSearchFailuresRemaining -= 1;
    return true;
  }
}

export function isScenarioName(value: unknown): value is ScenarioName {
  return (
    typeof value === "string" && scenarioNames.includes(value as ScenarioName)
  );
}
