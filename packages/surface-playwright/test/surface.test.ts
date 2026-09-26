import type { Server } from "node:http";

import type { TargetLocator } from "@computer-use/contracts";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createContactsApp } from "../../../apps/contacts/src/app.js";
import { ScenarioController } from "../../../apps/contacts/src/scenarios.js";
import {
  AmbiguousTargetError,
  PlaywrightSurfaceAdapter,
  RouteNotAllowedError,
  TargetNotFoundError,
} from "../src/index.js";

const searchTarget: TargetLocator = {
  strategies: [{ type: "label", label: "Member search", exact: true }],
  expectedCardinality: 1,
  rationale: "The search input has one stable accessible label",
};

describe("PlaywrightSurfaceAdapter", () => {
  let server: Server;
  let baseUrl: string;
  let browser: Browser;
  let scenarios: ScenarioController;

  beforeAll(async () => {
    scenarios = new ScenarioController();
    server = createContactsApp({ scenarios }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  it.each([
    { name: "wide", width: 1440, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "narrow", width: 375, height: 667 },
  ])(
    "resolves the same semantic search control at $name size",
    async (viewport) => {
      const page = await browser.newPage({ viewport });
      const adapter = createAdapter(page);
      await page.goto(`${baseUrl}/contacts`);

      const resolved = await adapter.resolveTarget(searchTarget);
      await resolved.locator.fill("M-1001");

      expect(await resolved.locator.inputValue()).toBe("M-1001");
      await page.close();
    },
  );

  it("uses an explicit narrow-layout Actions branch", async () => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 667 },
    });
    const adapter = createAdapter(page);
    await page.goto(`${baseUrl}/contacts?q=M-1001`);

    await adapter.act(
      {
        type: "click",
        target: {
          strategies: [{ type: "text", text: "Actions", exact: true }],
          expectedCardinality: 1,
          rationale:
            "Narrow member cards expose their actions through a disclosure",
        },
      },
      {},
    );
    const edit = await adapter.resolveTarget({
      strategies: [
        { type: "role", role: "link", name: "Edit contact", exact: true },
      ],
      expectedCardinality: 1,
      rationale: "The disclosed narrow-layout edit link is uniquely named",
    });

    expect(await edit.locator.isVisible()).toBe(true);
    await page.close();
  });

  it("fails closed when no approved strategy resolves", async () => {
    const page = await browser.newPage();
    const adapter = createAdapter(page);
    await page.goto(`${baseUrl}/contacts`);

    await expect(
      adapter.resolveTarget({
        strategies: [
          { type: "role", role: "button", name: "Missing", exact: true },
        ],
        expectedCardinality: 1,
        rationale: "Negative test",
      }),
    ).rejects.toBeInstanceOf(TargetNotFoundError);
    await page.close();
  });

  it("fails closed when a strategy resolves multiple visible controls", async () => {
    scenarios.set("ambiguous-actions");
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const adapter = createAdapter(page);
    await page.goto(`${baseUrl}/contacts?q=M-1001`);

    await expect(
      adapter.resolveTarget({
        strategies: [{ type: "role", role: "link", name: "Edit", exact: true }],
        expectedCardinality: 1,
        rationale: "The row edit action must be unique",
      }),
    ).rejects.toBeInstanceOf(AmbiguousTargetError);
    scenarios.reset();
    await page.close();
  });

  it("rejects navigation outside the allowed origin", async () => {
    const page = await browser.newPage();
    const adapter = createAdapter(page);

    await expect(
      adapter.act(
        { type: "navigate", urlTemplate: "https://example.com/" },
        {},
      ),
    ).rejects.toBeInstanceOf(RouteNotAllowedError);
    await page.close();
  });

  it("observes controls without copying field values", async () => {
    const page = await browser.newPage();
    const adapter = createAdapter(page);
    await page.goto(`${baseUrl}/contacts/M-1001/edit`);
    await page.getByLabel("Phone", { exact: true }).fill("555-0198");

    const observation = await adapter.observe();

    expect(JSON.stringify(observation)).not.toContain("555-0198");
    expect(
      observation.elements.some((element) => element.name === "Phone"),
    ).toBe(true);
    await page.close();
  });

  function createAdapter(page: Page): PlaywrightSurfaceAdapter {
    return new PlaywrightSurfaceAdapter(page, {
      allowedOrigins: [new URL(baseUrl).origin],
      allowedRoutes: ["/contacts", "/contacts/*", "/admin/*", "/assets/*"],
    });
  }
});
