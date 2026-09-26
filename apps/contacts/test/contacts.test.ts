import type { Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContactsApp } from "../src/app.js";

describe("Member Contacts Admin", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = createContactsApp();
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  it("lists the deterministic synthetic seed data", async () => {
    const response = await fetch(`${baseUrl}/contacts`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Avery Jordan");
    expect(html).toContain("M-1003");
  });

  it("renders contact-not-found as a visible business state", async () => {
    const response = await fetch(`${baseUrl}/contacts?q=does-not-exist`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("No contacts found");
  });

  it("creates and reads a synthetic contact", async () => {
    const createResponse = await submit("/contacts", {
      firstName: "Casey",
      lastName: "Nguyen",
      email: "casey.nguyen@example.test",
      phone: "555-0201",
      address: "401 Elm Lane, Northbank, NY 10004",
    });

    expect(createResponse.status).toBe(303);
    expect(createResponse.headers.get("location")).toBe(
      "/contacts/M-1004?created=1",
    );

    const detailResponse = await fetch(`${baseUrl}/contacts/M-1004`);
    expect(await detailResponse.text()).toContain("Casey Nguyen");
  });

  it("generates sequential member IDs without accepting a supplied ID", async () => {
    const first = await submit("/contacts", {
      memberId: "M-9999",
      firstName: "First",
      lastName: "Generated",
      email: "first.generated@example.test",
      phone: "555-0201",
      address: "401 Elm Lane, Northbank, NY 10004",
    });
    const second = await submit("/contacts", {
      firstName: "Second",
      lastName: "Generated",
      email: "second.generated@example.test",
      phone: "555-0202",
      address: "402 Elm Lane, Northbank, NY 10004",
    });

    expect(first.headers.get("location")).toBe("/contacts/M-1004?created=1");
    expect(second.headers.get("location")).toBe("/contacts/M-1005?created=1");
    expect((await fetch(`${baseUrl}/contacts/M-9999`)).status).toBe(404);
  });

  it("updates an existing contact", async () => {
    const updateResponse = await submit("/contacts/M-1001", {
      firstName: "Avery",
      lastName: "Jordan",
      email: "avery.jordan@example.test",
      phone: "555-0199",
      address: "101 Maple Street, Northbank, NY 10001",
    });

    expect(updateResponse.status).toBe(303);
    const detailResponse = await fetch(`${baseUrl}/contacts/M-1001`);
    expect(await detailResponse.text()).toContain("555-0199");
  });

  it("rejects duplicate email addresses", async () => {
    const response = await submit("/contacts", {
      firstName: "Duplicate",
      lastName: "Member",
      email: "avery.jordan@example.test",
      phone: "555-0202",
      address: "402 Elm Lane, Northbank, NY 10004",
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toContain(
      "That email address is already assigned to another member.",
    );
  });

  it("deletes a contact only through the confirmation endpoint", async () => {
    const confirmation = await fetch(`${baseUrl}/contacts/M-1002/delete`);
    expect(await confirmation.text()).toContain("Confirm delete");

    const deleteResponse = await fetch(`${baseUrl}/contacts/M-1002/delete`, {
      method: "POST",
      redirect: "manual",
    });
    expect(deleteResponse.status).toBe(303);

    const detailResponse = await fetch(`${baseUrl}/contacts/M-1002`);
    expect(detailResponse.status).toBe(404);
  });

  it("resets all mutations to the deterministic fixture", async () => {
    await fetch(`${baseUrl}/contacts/M-1003/delete`, { method: "POST" });
    const resetResponse = await fetch(`${baseUrl}/admin/reset`, {
      method: "POST",
    });

    expect(resetResponse.status).toBe(200);
    expect(await resetResponse.json()).toEqual({
      status: "reset",
      memberCount: 3,
    });
    expect((await fetch(`${baseUrl}/contacts/M-1003`)).status).toBe(200);
  });

  async function submit(
    path: string,
    fields: Record<string, string>,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      redirect: "manual",
    });
  }
});
