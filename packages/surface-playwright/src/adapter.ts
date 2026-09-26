import type {
  Action,
  Check,
  LocatorStrategy,
  TargetLocator,
  ValueSource,
} from "@computer-use/contracts";
import type { Frame, Locator, Page, PageScreenshotOptions } from "playwright";

import {
  AmbiguousTargetError,
  RouteNotAllowedError,
  TargetNotFoundError,
  UnsupportedCheckError,
} from "./errors.js";

interface SemanticRoot {
  getByLabel(text: string, options?: { exact?: boolean }): Locator;
  getByRole(
    role: PlaywrightRole,
    options?: { exact?: boolean; name?: string },
  ): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  locator(selector: string): Locator;
}

export interface SurfaceAdapterOptions {
  allowedOrigins: readonly string[];
  allowedRoutes: readonly string[];
  markerReader?: (
    name: string,
  ) => Promise<string | number | boolean | undefined>;
}

export interface SurfaceObservationElement {
  tag: string;
  role: string | undefined;
  name: string;
  inputType: string | undefined;
  visible: boolean;
  enabled: boolean;
}

export interface SurfaceObservation {
  url: string;
  title: string;
  viewport: { width: number; height: number } | null;
  elements: SurfaceObservationElement[];
}

export interface ResolvedTarget {
  locator: Locator;
  strategyIndex: number;
  strategy: LocatorStrategy;
}

export interface SurfaceTargetInspection {
  target: TargetLocator;
  strategyIndex: number;
  tag: string;
  role: string | undefined;
  name: string;
  inputType: string | undefined;
  href: string | undefined;
}

export type ActionResult =
  | { kind: "completed" }
  | { kind: "captured"; output: string; value: string }
  | { kind: "human_control_required"; reasonCode: string };

export class PlaywrightSurfaceAdapter {
  constructor(
    readonly page: Page,
    readonly options: SurfaceAdapterOptions,
  ) {}

  async observe(): Promise<SurfaceObservation> {
    this.assertCurrentLocationAllowed();
    const [title, viewport, elements] = await Promise.all([
      this.page.title(),
      Promise.resolve(this.page.viewportSize()),
      this.page.locator("body").evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            "button, a, input, select, textarea, summary, [role]",
          ),
        ).slice(0, 200);

        return candidates.map((element) => {
          const style = window.getComputedStyle(element);
          const rectangle = element.getBoundingClientRect();
          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rectangle.width > 0 &&
            rectangle.height > 0;
          const label =
            element.id.length > 0
              ? document.querySelector<HTMLLabelElement>(
                  `label[for="${CSS.escape(element.id)}"]`,
                )?.innerText
              : undefined;
          const text =
            element.getAttribute("aria-label") ??
            label ??
            element.innerText ??
            element.textContent ??
            "";
          const inputType =
            element instanceof HTMLInputElement ? element.type : undefined;
          const enabled =
            !(element instanceof HTMLButtonElement) &&
            !(element instanceof HTMLInputElement) &&
            !(element instanceof HTMLSelectElement) &&
            !(element instanceof HTMLTextAreaElement)
              ? true
              : !element.disabled;

          const explicitRole = element.getAttribute("role") ?? undefined;
          const implicitRole =
            element instanceof HTMLAnchorElement && element.hasAttribute("href")
              ? "link"
              : element instanceof HTMLButtonElement
                ? "button"
                : element instanceof HTMLTextAreaElement
                  ? "textbox"
                  : element instanceof HTMLInputElement
                    ? element.type === "submit" || element.type === "button"
                      ? "button"
                      : element.type === "checkbox"
                        ? "checkbox"
                        : "textbox"
                    : undefined;

          return {
            tag: element.tagName.toLowerCase(),
            role: explicitRole ?? implicitRole,
            name: text.trim().replace(/\s+/g, " ").slice(0, 160),
            inputType,
            visible,
            enabled,
          };
        });
      }),
    ]);

    return {
      url: this.page.url(),
      title,
      viewport,
      elements,
    };
  }

  async resolveTarget(target: TargetLocator): Promise<ResolvedTarget> {
    this.assertCurrentLocationAllowed();
    const root = this.getRoot(target);

    for (const [strategyIndex, strategy] of target.strategies.entries()) {
      const candidate = this.locatorForStrategy(root, strategy);
      const visibleCandidates = await this.visibleCandidates(candidate);

      if (visibleCandidates.length > target.expectedCardinality) {
        throw new AmbiguousTargetError(
          `Strategy ${strategyIndex + 1} matched ${visibleCandidates.length} visible controls; expected exactly ${target.expectedCardinality}`,
        );
      }

      if (visibleCandidates.length === target.expectedCardinality) {
        const locator = visibleCandidates[0];
        if (locator === undefined) {
          break;
        }
        return { locator, strategyIndex, strategy };
      }
    }

    throw new TargetNotFoundError(
      `No approved locator strategy resolved ${target.expectedCardinality} visible control`,
    );
  }

  async inspectTarget(target: TargetLocator): Promise<SurfaceTargetInspection> {
    const resolved = await this.resolveTarget(target);
    const facts = await resolved.locator.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      const label =
        htmlElement.id.length > 0
          ? document.querySelector<HTMLLabelElement>(
              `label[for="${CSS.escape(htmlElement.id)}"]`,
            )?.innerText
          : undefined;
      const name =
        htmlElement.getAttribute("aria-label") ??
        label ??
        htmlElement.innerText ??
        htmlElement.textContent ??
        "";
      const inputType =
        htmlElement instanceof HTMLInputElement ? htmlElement.type : undefined;
      const role =
        htmlElement.getAttribute("role") ??
        (htmlElement instanceof HTMLAnchorElement &&
        htmlElement.hasAttribute("href")
          ? "link"
          : htmlElement instanceof HTMLButtonElement
            ? "button"
            : htmlElement instanceof HTMLInputElement ||
                htmlElement instanceof HTMLTextAreaElement
              ? "textbox"
              : undefined);
      const href =
        htmlElement instanceof HTMLAnchorElement ? htmlElement.href : undefined;
      return {
        tag: htmlElement.tagName.toLowerCase(),
        role,
        name: name.trim().replace(/\s+/g, " ").slice(0, 160),
        inputType,
        href,
      };
    });
    return {
      target: structuredClone(target),
      strategyIndex: resolved.strategyIndex,
      ...facts,
    };
  }

  async act(
    action: Action,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<ActionResult> {
    if (action.type === "navigate") {
      const destination = this.interpolate(action.urlTemplate, inputs);
      this.assertUrlAllowed(destination);
      await this.page.goto(destination);
      this.assertCurrentLocationAllowed();
      return { kind: "completed" };
    }

    if (action.type === "human_control") {
      return { kind: "human_control_required", reasonCode: action.reasonCode };
    }

    const { locator } = await this.resolveTarget(action.target);
    if (action.type === "click") {
      await locator.click();
      return { kind: "completed" };
    }
    if (action.type === "fill") {
      await locator.fill(this.resolveValue(action.value, inputs));
      return { kind: "completed" };
    }
    if (action.type === "select") {
      await locator.selectOption(this.resolveValue(action.value, inputs));
      return { kind: "completed" };
    }

    const value = (await locator.textContent())?.trim() ?? "";
    return { kind: "captured", output: action.output, value };
  }

  async check(check: Check): Promise<boolean> {
    if (check.kind === "url") {
      return matchesPattern(new URL(this.page.url()).pathname, check.pattern);
    }

    if (check.kind === "marker") {
      if (this.options.markerReader === undefined) {
        throw new UnsupportedCheckError(
          `Marker check ${check.name} requires an explicit marker reader`,
        );
      }
      return (await this.options.markerReader(check.name)) === check.value;
    }

    try {
      const { locator } = await this.resolveTarget(check.target);
      if (check.state === "visible") return locator.isVisible();
      if (check.state === "hidden") return !(await locator.isVisible());
      if (check.state === "enabled") return locator.isEnabled();
      return !(await locator.isEnabled());
    } catch (error) {
      if (error instanceof TargetNotFoundError && check.state === "hidden") {
        return true;
      }
      throw error;
    }
  }

  async settle(checks: readonly Check[], timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const results = await Promise.all(
        checks.map(async (check) => this.check(check)),
      );
      if (results.every(Boolean)) {
        return;
      }
      await this.page.waitForTimeout(50);
    }
    throw new SurfaceErrorWithTimeout(
      `Settle conditions did not pass within ${timeoutMs}ms`,
    );
  }

  async captureScreenshot(
    options: Omit<PageScreenshotOptions, "mask"> & {
      maskTargets?: readonly TargetLocator[];
    } = {},
  ): Promise<Buffer> {
    const { maskTargets = [], ...screenshotOptions } = options;
    const mask = await Promise.all(
      maskTargets.map(
        async (target) => (await this.resolveTarget(target)).locator,
      ),
    );
    return this.page.screenshot({ ...screenshotOptions, mask });
  }

  assertCurrentLocationAllowed(): void {
    if (this.page.url() === "about:blank") {
      return;
    }
    this.assertUrlAllowed(this.page.url());
  }

  assertUrlAllowed(value: string): void {
    const url = new URL(value);
    if (!this.options.allowedOrigins.includes(url.origin)) {
      throw new RouteNotAllowedError(`Origin ${url.origin} is not allowlisted`);
    }
    if (
      !this.options.allowedRoutes.some((pattern) =>
        matchesPattern(url.pathname, pattern),
      )
    ) {
      throw new RouteNotAllowedError(
        `Route ${url.pathname} is not allowlisted`,
      );
    }
  }

  getRoot(target: TargetLocator): SemanticRoot {
    let root: SemanticRoot = this.frameFor(target);
    const context = target.context;
    if (context?.ancestorRole !== undefined) {
      root = root.getByRole(
        context.ancestorRole as PlaywrightRole,
        context.ancestorName === undefined
          ? { exact: true }
          : { exact: true, name: context.ancestorName },
      );
    }
    return root;
  }

  frameFor(target: TargetLocator): Page | Frame {
    const frameName = target.context?.frameName;
    if (frameName === undefined) {
      return this.page;
    }
    const frame = this.page.frame({ name: frameName });
    if (frame === null) {
      throw new TargetNotFoundError(`Frame ${frameName} was not found`);
    }
    return frame;
  }

  locatorForStrategy(root: SemanticRoot, strategy: LocatorStrategy): Locator {
    if (strategy.type === "role") {
      return root.getByRole(strategy.role as PlaywrightRole, {
        name: strategy.name,
        exact: strategy.exact,
      });
    }
    if (strategy.type === "label") {
      return root.getByLabel(strategy.label, { exact: strategy.exact });
    }
    if (strategy.type === "text") {
      return root.getByText(strategy.text, { exact: strategy.exact });
    }
    const cssRoot =
      strategy.scope === undefined ? root : root.locator(strategy.scope);
    return cssRoot.locator(strategy.selector);
  }

  async visibleCandidates(locator: Locator): Promise<Locator[]> {
    const count = await locator.count();
    const visible: Locator[] = [];
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) {
        visible.push(candidate);
      }
    }
    return visible;
  }

  resolveValue(
    source: ValueSource,
    inputs: Readonly<Record<string, unknown>>,
  ): string {
    if (source.kind === "literal") {
      return String(source.value);
    }
    const value = inputs[source.name];
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new TypeError(`Input ${source.name} must be a scalar value`);
    }
    return String(value);
  }

  interpolate(
    template: string,
    inputs: Readonly<Record<string, unknown>>,
  ): string {
    return template.replace(
      /\{([a-zA-Z][a-zA-Z0-9._-]*)\}/g,
      (_match, name: string) => {
        const value = inputs[name];
        if (typeof value !== "string" && typeof value !== "number") {
          throw new TypeError(
            `Navigation input ${name} must be a string or number`,
          );
        }
        return encodeURIComponent(String(value));
      },
    );
  }
}

type PlaywrightRole = Parameters<Page["getByRole"]>[0];

class SurfaceErrorWithTimeout extends Error {
  readonly code = "SETTLE_TIMEOUT";

  constructor(message: string) {
    super(message);
    this.name = "SettleTimeoutError";
  }
}

function matchesPattern(value: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
}
