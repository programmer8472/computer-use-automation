import type { Action, Check, TargetLocator } from "@computer-use/contracts";

export function hydrateAction(
  action: Action,
  inputs: Readonly<Record<string, unknown>>,
): Action {
  if (action.type === "navigate") {
    return {
      type: "navigate",
      urlTemplate: interpolate(action.urlTemplate, inputs),
    };
  }
  if (action.type === "human_control") return structuredClone(action);
  const target = hydrateTarget(action.target, inputs);
  if (action.type === "click") return { type: "click", target };
  if (action.type === "capture") {
    return { type: "capture", target, output: action.output };
  }
  return {
    type: action.type,
    target,
    value: structuredClone(action.value),
  };
}

export function hydrateCheck(
  check: Check,
  inputs: Readonly<Record<string, unknown>>,
): Check {
  if (check.kind === "url") {
    return { kind: "url", pattern: interpolate(check.pattern, inputs) };
  }
  if (check.kind === "marker") return structuredClone(check);
  return {
    kind: "element",
    target: hydrateTarget(check.target, inputs),
    state: check.state,
  };
}

function hydrateTarget(
  target: TargetLocator,
  inputs: Readonly<Record<string, unknown>>,
): TargetLocator {
  return {
    ...structuredClone(target),
    strategies: target.strategies.map((strategy) => {
      if (strategy.type === "role") {
        return { ...strategy, name: interpolate(strategy.name, inputs) };
      }
      if (strategy.type === "label") {
        return { ...strategy, label: interpolate(strategy.label, inputs) };
      }
      if (strategy.type === "text") {
        return { ...strategy, text: interpolate(strategy.text, inputs) };
      }
      return {
        ...strategy,
        selector: interpolate(strategy.selector, inputs),
        ...(strategy.scope === undefined
          ? {}
          : { scope: interpolate(strategy.scope, inputs) }),
      };
    }),
  };
}

function interpolate(
  template: string,
  inputs: Readonly<Record<string, unknown>>,
): string {
  return template.replace(
    /\{([a-zA-Z][a-zA-Z0-9._-]*)\}/g,
    (_match, name: string) => {
      const value = inputs[name];
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new Error(`Template input ${name} must be a scalar value`);
      }
      return String(value);
    },
  );
}
