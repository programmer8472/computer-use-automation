import express, { type Express, type Request, type Response } from "express";

import {
  AutomationConsole,
  CapabilityInvocationError,
  type AutomationConsolePort,
  type AutomationRunView,
} from "./automation.js";
import { DemoLifecycle, type DemoLifecyclePort } from "./demo-lifecycle.js";
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
  automationClientScript,
  renderAutomationConsole,
  type AutomationWorkspaceState,
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
  automation?: AutomationConsolePort;
  demo?: DemoLifecyclePort;
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
  const demo = dependencies.demo ?? new DemoLifecycle(repository, scenarios);
  const automation =
    dependencies.automation ??
    new AutomationConsole(repository, scenarios, {
      contactUpdateCapabilityProvider: () => demo.approvedContactUpdate(),
    });
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
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

  app.get("/assets/automation.js", (_request, response) => {
    response.type("text/javascript").send(automationClientScript);
  });

  app.get("/", (_request, response) => {
    response.redirect(302, "/automation");
  });

  app.get("/automation", (request, response) => {
    const runId = readQuery(request.query.run);
    const workspace = readAutomationWorkspace(request, repository);
    response.send(
      renderAutomationConsole(
        repository.list(workspace.searchQuery),
        scenarios.active,
        runId.length === 0 ? undefined : automation.getRun(runId),
        workspace,
        demo.view(),
      ),
    );
  });

  app.get("/api/capabilities", (_request, response) => {
    response.json(automation.listCapabilities());
  });

  app.post(
    "/api/capabilities/:capabilityId/invoke",
    async (request, response) => {
      const capabilityId = readPathValue(request.params.capabilityId);
      const body = isRecord(request.body) ? request.body : {};
      const requestedScenario = readScenario(body);
      if ("scenario" in body && requestedScenario === undefined) {
        response.status(400).json({
          error: {
            code: "INVALID_SCENARIO",
            message:
              "scenario must be a supported deterministic test condition.",
          },
        });
        return;
      }
      const scenario = requestedScenario ?? "normal";
      try {
        const result = await automation.invoke(
          capabilityId,
          body.inputs,
          scenario,
          localOrigin(request),
        );
        demo.recordReplay(result);
        response.json({
          capabilityId,
          executionMode: "deterministic_replay",
          modelCallCount: result.modelCallCount,
          outputs: capabilityOutputs(capabilityId, result),
          result,
        });
      } catch (error) {
        if (error instanceof CapabilityInvocationError) {
          response
            .status(error.code === "CAPABILITY_NOT_FOUND" ? 404 : 400)
            .json({ error: { code: error.code, message: error.message } });
          return;
        }
        throw error;
      }
    },
  );

  app.post("/automation/run", async (request, response) => {
    const body = request.body as unknown;
    const instruction = readAutomationInstruction(body);
    const scenario = readScenario(body) ?? "normal";
    const result = await automation.run(
      instruction,
      scenario,
      localOrigin(request),
    );
    demo.recordReplay(result);
    response.redirect(
      303,
      `/automation?run=${encodeURIComponent(result.runId)}`,
    );
  });

  app.post("/automation/discover", async (request, response) => {
    await demo.runDiscovery(
      readAutomationInstruction(request.body as unknown),
      localOrigin(request),
    );
    response.redirect(303, "/automation?notice=discovery-finished");
  });

  app.post("/automation/approve", (request, response) => {
    demo.approve(readFormString(request.body as unknown, "reviewer"));
    response.redirect(303, "/automation?notice=approval-finished");
  });

  app.post("/automation/reset", (_request, response) => {
    demo.reset();
    automation.reset();
    response.redirect(303, "/automation?notice=demo-reset");
  });

  app.post("/automation/members", (request, response) => {
    const member = readNewMemberForm(request.body as unknown);
    const errors = validateNewMemberInput(member);
    if (Object.keys(errors).length > 0) {
      response.status(422).send(
        renderAutomationConsole(
          repository.list(),
          scenarios.active,
          undefined,
          {
            editor: {
              mode: "create",
              member: { memberId: "", ...member },
              errors,
            },
          },
          demo.view(),
        ),
      );
      return;
    }

    const result = repository.create(member);
    if (!result.ok) {
      response.status(409).send(
        renderAutomationConsole(
          repository.list(),
          scenarios.active,
          undefined,
          {
            editor: {
              mode: "create",
              member: { memberId: "", ...member },
              formError:
                "That email address is already assigned to another member.",
            },
          },
          demo.view(),
        ),
      );
      return;
    }
    response.redirect(303, "/automation?notice=created");
  });

  app.post("/automation/members/:memberId", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    const existingMember = repository.get(memberId);
    if (existingMember === undefined) {
      response.redirect(303, "/automation?notice=not-found");
      return;
    }
    const member = readMemberForm(request.body as unknown, memberId);
    const errors = validateMemberInput(member);
    const ssnProvided = hasSsnValue(request.body as unknown);
    const invalidSsn =
      ssnProvided && !hasValidSsnShape(request.body as unknown);
    if (Object.keys(errors).length > 0 || invalidSsn) {
      response.status(422).send(
        renderAutomationConsole(
          repository.list(),
          scenarios.active,
          undefined,
          {
            editor: {
              mode: "edit",
              member,
              errors,
              ssnOnFile: existingMember.ssnOnFile,
              invalidSsn,
            },
          },
          demo.view(),
        ),
      );
      return;
    }

    const result = repository.update(memberId, member);
    if (result === undefined) {
      response.redirect(303, "/automation?notice=not-found");
      return;
    }
    if (!result.ok) {
      response.status(409).send(
        renderAutomationConsole(
          repository.list(),
          scenarios.active,
          undefined,
          {
            editor: {
              mode: "edit",
              member,
              formError:
                "That email address is already assigned to another member.",
              ssnOnFile: existingMember.ssnOnFile,
            },
          },
          demo.view(),
        ),
      );
      return;
    }
    if (ssnProvided) repository.markSsnOnFile(memberId);
    response.redirect(
      303,
      `/automation?notice=${ssnProvided ? "member-and-ssn-updated" : "updated"}`,
    );
  });

  app.post("/automation/members/:memberId/delete", (request, response) => {
    const memberId = readPathParameter(request.params.memberId);
    const deleted = repository.delete(memberId);
    response.redirect(
      303,
      `/automation?notice=${deleted ? "deleted" : "not-found"}`,
    );
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

function readAutomationInstruction(body: unknown): string {
  return isRecord(body) && typeof body.instruction === "string"
    ? body.instruction
    : "";
}

function readFormString(body: unknown, key: string): string {
  return isRecord(body) && typeof body[key] === "string" ? body[key] : "";
}

function readAutomationWorkspace(
  request: Request,
  repository: MemberRepository,
): AutomationWorkspaceState {
  const state: AutomationWorkspaceState = {
    searchQuery: readQuery(request.query.q).trim(),
  };
  const notices: Record<string, string> = {
    created: "Member created.",
    updated: "Member updated.",
    "member-and-ssn-updated":
      "Member updated. The submitted SSN was discarded; only its on-file status was retained.",
    deleted: "Member removed.",
    reset: "Members and test conditions reset.",
    "demo-reset":
      "Demo reset to Phase 1. Contacts and runtime state were restored; audit evidence remains on disk.",
    "discovery-finished":
      "Discovery run finished. Review the lifecycle result.",
    "approval-finished": "Approval step finished. Review the lifecycle status.",
    "not-found": "The requested member no longer exists.",
  };
  const notice = notices[readQuery(request.query.notice)];
  if (notice !== undefined) state.notice = notice;

  if (readQuery(request.query.add) === "1") {
    state.editor = { mode: "create", member: blankMember };
    return state;
  }

  const editMemberId = readQuery(request.query.edit).toUpperCase();
  if (editMemberId.length > 0) {
    const member = repository.get(editMemberId);
    if (member === undefined) {
      state.notice = "The requested member no longer exists.";
    } else {
      state.editor = {
        mode: "edit",
        member,
        ssnOnFile: member.ssnOnFile,
      };
    }
  }
  return state;
}

function localOrigin(request: Request): string {
  const port = request.socket.localPort;
  if (port === undefined) {
    throw new Error("The local automation server port is unavailable");
  }
  return `http://127.0.0.1:${port}`;
}

function readPathParameter(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function readPathValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function capabilityOutputs(
  capabilityId: string,
  result: AutomationRunView,
): Record<string, boolean> {
  if (capabilityId === "contact.update-phone") {
    return { updated: result.resultKind === "success" };
  }
  if (capabilityId === "contact.find-member") {
    return { found: result.resultKind === "success" };
  }
  return {};
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
