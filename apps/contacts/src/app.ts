import express, { type Express, type Request, type Response } from "express";

import {
  readNewMemberForm,
  readMemberForm,
  validateNewMemberInput,
  validateMemberInput,
  type MemberInput,
} from "./member.js";
import { MemberRepository } from "./repository.js";
import {
  isScenarioName,
  ScenarioController,
  type ScenarioName,
} from "./scenarios.js";
import {
  renderContactsList,
  renderDeleteConfirmation,
  renderMemberDetails,
  renderMemberForm,
  renderNotFound,
  renderScenarioControls,
  renderTransientFailure,
  styles,
} from "./views.js";

export interface ContactsAppDependencies {
  repository?: MemberRepository;
  scenarios?: ScenarioController;
}

const blankMember: MemberInput = {
  memberId: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
};

export function createContactsApp(
  dependencies: ContactsAppDependencies = {},
): Express {
  const repository = dependencies.repository ?? new MemberRepository();
  const scenarios = dependencies.scenarios ?? new ScenarioController();
  const app = express();

  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/assets/styles.css", (_request, response) => {
    response.type("text/css").send(styles);
  });

  app.get("/", (_request, response) => {
    response.redirect(302, "/contacts");
  });

  app.get("/contacts", (request, response) => {
    const query = readQuery(request.query.q);
    if (query.length > 0 && scenarios.consumeTransientSearchFailure()) {
      response.status(503).send(renderTransientFailure(query));
      return;
    }
    response.send(
      renderContactsList(repository.list(query), query, scenarios.active),
    );
  });

  app.get("/contacts/new", (_request, response) => {
    response.send(renderMemberForm("create", blankMember));
  });

  app.post("/contacts", (request, response) => {
    const member = readNewMemberForm(request.body as unknown);
    const errors = validateNewMemberInput(member);
    if (Object.keys(errors).length > 0) {
      response
        .status(422)
        .send(renderMemberForm("create", { ...member, memberId: "" }, errors));
      return;
    }

    const result = repository.create(member);
    if (!result.ok) {
      response
        .status(409)
        .send(
          renderMemberForm(
            "create",
            { ...member, memberId: "" },
            {},
            "That email address is already assigned to another member.",
          ),
        );
      return;
    }

    response.redirect(
      303,
      `/contacts/${encodeURIComponent(result.member.memberId)}?created=1`,
    );
  });

  app.get("/contacts/:memberId", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    const member = repository.get(memberId);
    if (member === undefined) {
      sendNotFound(response, memberId);
      return;
    }

    const contactUpdated = request.query.updated === "1";
    const ssnUpdated = request.query.ssnUpdated === "1";
    const message =
      request.query.created === "1"
        ? "Contact created."
        : contactUpdated && ssnUpdated
          ? "Contact and SSN status updated by the operator."
          : contactUpdated
            ? "Contact updated."
            : "";
    response.send(renderMemberDetails(member, message, scenarios.active));
  });

  app.get("/contacts/:memberId/edit", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    const member = repository.get(memberId);
    if (member === undefined) {
      sendNotFound(response, memberId);
      return;
    }
    response.send(
      renderMemberForm("edit", member, {}, "", {
        ssnOnFile: member.ssnOnFile,
        invalidSsn: false,
      }),
    );
  });

  app.post("/contacts/:memberId", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    const existingMember = repository.get(memberId);
    if (existingMember === undefined) {
      sendNotFound(response, memberId);
      return;
    }

    const member = readMemberForm(request.body as unknown, memberId);
    const errors = validateMemberInput(member);
    const ssnProvided = hasSsnValue(request.body as unknown);
    const invalidSsn =
      ssnProvided && !hasValidSsnShape(request.body as unknown);
    if (Object.keys(errors).length > 0 || invalidSsn) {
      response.status(422).send(
        renderMemberForm("edit", member, errors, "", {
          ssnOnFile: existingMember.ssnOnFile,
          invalidSsn,
        }),
      );
      return;
    }

    const result = repository.update(memberId, member);
    if (result === undefined) {
      sendNotFound(response, memberId);
      return;
    }
    if (!result.ok) {
      response
        .status(409)
        .send(
          renderMemberForm(
            "edit",
            member,
            {},
            "That email address is already assigned to another member.",
            { ssnOnFile: existingMember.ssnOnFile, invalidSsn: false },
          ),
        );
      return;
    }

    if (ssnProvided) {
      repository.markSsnOnFile(memberId);
    }

    response.redirect(
      303,
      `/contacts/${encodeURIComponent(memberId)}?updated=1${ssnProvided ? "&ssnUpdated=1" : ""}`,
    );
  });

  app.get("/contacts/:memberId/delete", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    const member = repository.get(memberId);
    if (member === undefined) {
      sendNotFound(response, memberId);
      return;
    }
    response.send(renderDeleteConfirmation(member));
  });

  app.post("/contacts/:memberId/delete", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    if (!repository.delete(memberId)) {
      sendNotFound(response, memberId);
      return;
    }
    response.redirect(303, "/contacts");
  });

  app.get("/admin/scenarios", (_request, response) => {
    response.send(renderScenarioControls(scenarios.active));
  });

  app.post("/admin/scenario", (request, response) => {
    const scenario = readScenario(request.body as unknown);
    if (scenario === undefined) {
      response.status(400).json({ error: "unknown_scenario" });
      return;
    }
    scenarios.set(scenario);
    response.redirect(303, "/admin/scenarios");
  });

  app.post("/admin/scenario/dismiss", (request, response) => {
    scenarios.dismissDialog();
    response.redirect(303, readSafeReturnPath(request.body as unknown));
  });

  app.post("/admin/reset", (_request, response) => {
    repository.reset();
    scenarios.reset();
    response.json({ status: "reset", memberCount: repository.list().length });
  });

  app.use((request, response) => {
    response
      .status(404)
      .send(renderNotFound(`${request.method} ${request.originalUrl}`));
  });

  return app;
}

function readQuery(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readPathParameter(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function sendNotFound(response: Response, memberId: string): void {
  response.status(404).send(renderNotFound(memberId));
}

function hasValidSsnShape(body: unknown): boolean {
  if (!isRecord(body) || typeof body.ssn !== "string") {
    return false;
  }
  return /^[0-9]{3}-?[0-9]{2}-?[0-9]{4}$/.test(body.ssn);
}

function hasSsnValue(body: unknown): boolean {
  return isRecord(body) && typeof body.ssn === "string" && body.ssn.length > 0;
}

function readScenario(body: unknown): ScenarioName | undefined {
  if (!isRecord(body) || !isScenarioName(body.scenario)) {
    return undefined;
  }
  return body.scenario;
}

function readSafeReturnPath(body: unknown): string {
  if (!isRecord(body) || typeof body.returnTo !== "string") {
    return "/contacts";
  }
  return body.returnTo.startsWith("/") && !body.returnTo.startsWith("//")
    ? body.returnTo
    : "/contacts";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { Request, Response };
