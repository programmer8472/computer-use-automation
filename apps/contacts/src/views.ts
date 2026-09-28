import type { Member, MemberInput, ValidationErrors } from "./member.js";
import { scenarioNames, type ScenarioName } from "./scenarios.js";
import type { AutomationRunView } from "./automation.js";
import type { DemoLifecycleView } from "./demo-lifecycle.js";

export interface AutomationWorkspaceEditor {
  mode: "create" | "edit";
  member: MemberInput;
  errors?: ValidationErrors;
  formError?: string;
  ssnOnFile?: boolean;
  invalidSsn?: boolean;
}

export interface AutomationWorkspaceState {
  notice?: string;
  editor?: AutomationWorkspaceEditor;
  searchQuery?: string;
}

export function renderLayout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | Member Contacts Admin</title>
    <link rel="stylesheet" href="/assets/styles.css">
    <script src="/assets/automation.js" defer></script>
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/automation">Northbank Automation Console</a>
      <span class="environment">Synthetic training environment</span>
    </header>
    <main>${content}</main>
  </body>
</html>`;
}

export function renderAutomationConsole(
  members: Member[],
  activeScenario: ScenarioName,
  run?: AutomationRunView,
  workspace: AutomationWorkspaceState = {},
  lifecycle: DemoLifecycleView = {
    status: "discovery_required",
    activePhase: 1,
    modelConfigured: false,
    modelName: "not configured",
    busy: false,
  },
): string {
  const searchQuery = workspace.searchQuery ?? "";
  const instruction =
    run?.instruction ??
    lifecycle.discovery?.goal ??
    "Update member M-1001's phone number to 555-0195";
  const replayEnabled = lifecycle.approval !== undefined;
  return renderLayout(
    "Automation Console",
    `<div class="console-heading">
      <div><p class="eyebrow">Computer-use lifecycle demonstration</p><h1>Member Contacts Automation Lab</h1></div>
      <form class="demo-reset-form" method="post" action="/automation/reset"><button class="secondary" type="submit">Reset entire demo</button></form>
    </div>
    <p class="console-intro">Watch one natural-language task move from live LLM discovery (“training”) to a reviewed artifact and then model-free deterministic replay.</p>
    ${renderLifecycleStrip(lifecycle)}
    ${workspace.notice === undefined ? "" : `<p class="success global-notice" role="status">${escapeHtml(workspace.notice)}</p>`}

    <div class="workspace-grid">
      <section class="console-panel members-panel" aria-labelledby="members-title">
        <div class="panel-heading">
          <div><p class="eyebrow">Application under test</p><h2 id="members-title">Member contacts</h2></div>
          <a class="button compact-button" href="/automation?add=1#member-editor">Add member</a>
        </div>
        <p class="panel-intro">This is the live application state. Changes made manually or by automation appear here.</p>
        ${renderWorkspaceSearch(searchQuery, members.length)}
        ${renderWorkspaceMembers(members, activeScenario, searchQuery)}
        ${workspace.editor === undefined ? "" : renderWorkspaceEditor(workspace.editor)}
      </section>

      <aside class="testing-column" aria-labelledby="testing-title">
        ${renderDiscoveryPanel(lifecycle, instruction)}
        ${renderApprovalPanel(lifecycle)}
        <section class="console-panel command-panel">
          <div class="phase-panel-heading"><div><p class="eyebrow">Phase 3 · deterministic replay</p><h2 id="testing-title">Run approved capability</h2></div><span class="call-count zero-calls">0 LLM calls</span></div>
          <p class="panel-intro">The LLM is now out of the loop. Replay resolves approved semantic targets at the current browser size and verifies every checkpoint.</p>
          <details class="capability-catalog">
            <summary>Capability contract catalog (2)</summary>
            <div>
              <code>contact.update-phone</code>
              <p><strong>Inputs:</strong> memberId: string, phone: string<br><strong>Output:</strong> updated: boolean</p>
            </div>
            <div>
              <code>contact.find-member</code>
              <p><strong>Input:</strong> memberId: string<br><strong>Output:</strong> found: boolean</p>
            </div>
            <p class="catalog-api">Machine-readable discovery: <code>GET /api/capabilities</code></p>
          </details>
        <form id="automation-command-form" method="post" action="/automation/run">
          <div class="field">
            <label for="instruction">Natural-language instruction</label>
            <textarea id="instruction" name="instruction" rows="3" required placeholder="Update member M-1001's phone number to 555-0199">${escapeHtml(instruction)}</textarea>
          </div>
          <div class="example-row" aria-label="Command examples">
            <span>Try:</span>
            <button class="example-command" type="button" data-command="Update member M-1001's phone number to 555-0199">Update a phone</button>
            <button class="example-command" type="button" data-command="Find member M-1001">Find a member</button>
            <button class="example-command" type="button" data-command="Find member M-9999">Show not found</button>
            <button class="example-command" type="button" data-command="Update the SSN for member M-1001">Request SSN change</button>
          </div>
          <fieldset class="scenario-picker">
            <legend>Test condition</legend>
            ${renderScenarioOption("normal", activeScenario, "Normal application behavior")}
            ${renderScenarioOption("ambiguous-actions", activeScenario, "Duplicate Edit controls; updates must stop safely")}
            ${renderScenarioOption("transient-search", activeScenario, "One temporary failure; use a Find member command")}
          </fieldset>
          <div class="actions">
            <button id="run-automation" type="submit" ${replayEnabled ? "" : "disabled"}>Run deterministic replay</button>
          </div>
          ${replayEnabled ? "" : '<p class="locked-message">Complete discovery and approval to unlock deterministic replay.</p>'}
          <p id="automation-progress" class="run-progress" role="status" aria-live="polite"></p>
        </form>
        </section>

        <section class="console-panel result-panel" aria-labelledby="result-title">
          <p class="eyebrow">Latest run</p>
          <h2 id="result-title">Result and exception status</h2>
          ${run === undefined ? renderEmptyAutomationResult() : renderAutomationResult(run)}
        </section>

        <section class="console-panel outcome-guide" aria-labelledby="outcomes-title">
          <h2 id="outcomes-title">How to read outcomes</h2>
          <div class="outcome-grid">
            <div><strong class="outcome success-tone">Success</strong><p>The action and final checkpoint passed.</p></div>
            <div><strong class="outcome business-tone">Business outcome</strong><p>The member does not exist; this is not a crash.</p></div>
            <div><strong class="outcome recovery-tone">Recovered</strong><p>A temporary failure was retried within the approved bound.</p></div>
            <div><strong class="outcome failure-tone">Hard failure</strong><p>Automation stopped safely and reports exactly why.</p></div>
            <div><strong class="outcome handoff-tone">Human handoff</strong><p>Sensitive work pauses for a human operator.</p></div>
          </div>
        </section>
      </aside>
    </div>`,
  );
}

function renderLifecycleStrip(lifecycle: DemoLifecycleView): string {
  const phases = [
    {
      number: 1,
      label: "LLM discovery (“training”)",
      detail: "Model explores once",
      complete: lifecycle.discovery !== undefined,
    },
    {
      number: 2,
      label: "Generate & approve",
      detail: "Trace becomes a signed capability",
      complete: lifecycle.approval !== undefined,
    },
    {
      number: 3,
      label: "Deterministic replay",
      detail: "Approved steps run with 0 LLM calls",
      complete: lifecycle.status === "replay_complete",
    },
  ];
  return `<section class="lifecycle" aria-labelledby="lifecycle-title">
    <div class="lifecycle-heading">
      <div><p class="eyebrow">Demo progress</p><h2 id="lifecycle-title">Discovery → capability → replay</h2></div>
      <span class="phase-status">Current phase: ${lifecycle.activePhase} of 3</span>
    </div>
    <ol class="phase-strip">
      ${phases
        .map((phase) => {
          const state = phase.complete
            ? "complete"
            : lifecycle.activePhase === phase.number
              ? "active"
              : "locked";
          return `<li class="phase-card phase-${state}" ${state === "active" ? 'aria-current="step"' : ""}>
            <span class="phase-number">${phase.complete ? "✓" : phase.number}</span>
            <span><strong>${escapeHtml(phase.label)}</strong><small>${escapeHtml(phase.detail)}</small></span>
            <span class="phase-state">${state}</span>
          </li>`;
        })
        .join("")}
    </ol>
    <p class="terminology-note"><strong>Terminology:</strong> “Training” here means task discovery, not changing model weights. Reset clears the on-screen session and restores seed data; immutable audit evidence remains available for verification.</p>
    ${lifecycle.error === undefined ? "" : `<p class="lifecycle-error" role="alert"><strong>Lifecycle stopped safely:</strong> ${escapeHtml(lifecycle.error)}</p>`}
  </section>`;
}

function renderDiscoveryPanel(
  lifecycle: DemoLifecycleView,
  instruction: string,
): string {
  const discovery = lifecycle.discovery;
  const configuration = lifecycle.modelConfigured
    ? `<span class="configuration-ready">API configured · ${escapeHtml(lifecycle.modelName)}</span>`
    : '<span class="configuration-missing">API key not detected</span>';
  if (discovery === undefined) {
    return `<section class="console-panel phase-work-panel" aria-labelledby="discovery-title">
      <div class="phase-panel-heading"><div><p class="eyebrow">Phase 1 · LLM discovery (“training”)</p><h2 id="discovery-title">Discover the workflow</h2></div>${configuration}</div>
      <p class="panel-intro">The model observes the live contacts app and selects one bounded semantic action per turn. Coordinates are never recorded.</p>
      <form id="discovery-form" method="post" action="/automation/discover">
        <div class="field">
          <label for="discovery-goal">Natural-language discovery goal</label>
          <textarea id="discovery-goal" name="instruction" rows="3" required>${escapeHtml(instruction)}</textarea>
        </div>
        <button id="run-discovery" type="submit" ${lifecycle.modelConfigured ? "" : "disabled"}>Run live LLM discovery</button>
        <p id="discovery-progress" class="run-progress" role="status" aria-live="polite">${lifecycle.modelConfigured ? "Uses the configured API model and generates a fresh redacted trace." : "Configure OPENAI_API_KEY and restart the app to enable live discovery."}</p>
      </form>
    </section>`;
  }
  return `<section class="console-panel phase-work-panel phase-complete-panel" aria-labelledby="discovery-title">
    <div class="phase-panel-heading"><div><p class="eyebrow">Phase 1 · discovery complete</p><h2 id="discovery-title">LLM found a working path</h2></div><span class="call-count model-calls">${discovery.modelCallCount} LLM calls</span></div>
    <p class="discovery-goal"><strong>Goal:</strong> ${escapeHtml(discovery.goal)}</p>
    <ol class="trace-steps">
      ${discovery.steps
        .map(
          (step) =>
            `<li><span class="trace-step-number">${step.number}</span><span><strong>${escapeHtml(step.action)}</strong><small>${escapeHtml(step.semanticTarget)}</small></span></li>`,
        )
        .join("")}
    </ol>
    <dl class="artifact-facts"><div><dt>Discovery run</dt><dd><code>${escapeHtml(discovery.runId)}</code></dd></div><div><dt>Redacted evidence</dt><dd><code>${escapeHtml(discovery.evidenceDirectory)}</code></dd></div></dl>
  </section>`;
}

function renderApprovalPanel(lifecycle: DemoLifecycleView): string {
  const draft = lifecycle.draft;
  if (draft === undefined) {
    return `<section class="console-panel phase-work-panel phase-locked-panel" aria-labelledby="approval-title">
      <p class="eyebrow">Phase 2 · generate & approve</p>
      <h2 id="approval-title">Capability not generated yet</h2>
      <p class="locked-message">A successful Phase 1 trace is required. The compiler—not the LLM—adds typed inputs, checks, policy, and outcome rules.</p>
    </section>`;
  }
  const approval = lifecycle.approval;
  if (approval === undefined) {
    return `<section class="console-panel phase-work-panel" aria-labelledby="approval-title">
      <div class="phase-panel-heading"><div><p class="eyebrow">Phase 2 · review required</p><h2 id="approval-title">Approve generated capability</h2></div><span class="draft-badge">Draft</span></div>
      <p class="panel-intro">The compiler converted the successful trace into a versioned artifact. Approval binds its exact content to a digest before execution.</p>
      ${renderDraftFacts(draft)}
      <form class="approval-form" method="post" action="/automation/approve">
        <div class="field"><label for="reviewer">Reviewer name</label><input id="reviewer" name="reviewer" required minlength="2" maxlength="80" placeholder="Alex Shein"></div>
        <button type="submit">Approve capability</button>
      </form>
    </section>`;
  }
  return `<section class="console-panel phase-work-panel phase-complete-panel" aria-labelledby="approval-title">
    <div class="phase-panel-heading"><div><p class="eyebrow">Phase 2 · approved</p><h2 id="approval-title">Capability is locked and executable</h2></div><span class="approved-badge">Approved</span></div>
    ${renderDraftFacts(draft)}
    <dl class="artifact-facts"><div><dt>Approved by</dt><dd>${escapeHtml(approval.approvedBy)}</dd></div><div><dt>Approved at</dt><dd>${escapeHtml(approval.approvedAt)}</dd></div><div class="wide-fact"><dt>Integrity digest</dt><dd><code>${escapeHtml(approval.digest)}</code></dd></div></dl>
  </section>`;
}

function renderDraftFacts(
  draft: NonNullable<DemoLifecycleView["draft"]>,
): string {
  return `<dl class="artifact-facts"><div><dt>Capability</dt><dd><code>${escapeHtml(draft.capabilityId)}</code> · revision ${draft.revision}</dd></div><div><dt>Mechanical steps</dt><dd>${draft.stepCount}</dd></div><div class="wide-fact"><dt>Typed inputs</dt><dd>${draft.inputNames.map((name) => `<code>${escapeHtml(name)}</code>`).join(", ")}</dd></div></dl>`;
}

function renderWorkspaceMembers(
  members: Member[],
  activeScenario: ScenarioName,
  searchQuery = "",
): string {
  if (members.length === 0) {
    return searchQuery.length === 0
      ? `<section class="notice" role="status"><h3>No members</h3><p>Add a synthetic member or reset the application.</p></section>`
      : `<section class="notice workspace-empty" role="status"><h3>No matching members</h3><p>No member matched “${escapeHtml(searchQuery)}”. Try another name, ID, email, or phone.</p><a class="button secondary compact-button" href="/automation">Clear search</a></section>`;
  }
  const ambiguityActive = activeScenario === "ambiguous-actions";
  return `<p class="scenario-preview" data-ambiguity-note ${ambiguityActive ? "" : "hidden"} role="status"><strong>Ambiguity injected:</strong> duplicate Edit controls are now visible.</p>
  <div class="workspace-members" aria-label="Current member contacts">
    ${members
      .map(
        (member) => `<article class="workspace-member">
          <div class="member-summary">
            <div><span class="member-id">${escapeHtml(member.memberId)}</span><h3>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</h3></div>
            <span class="ssn-status">SSN: ${member.ssnOnFile ? "On file" : "Not on file"}</span>
          </div>
          <dl class="member-facts">
            <div><dt>Email</dt><dd>${escapeHtml(member.email)}</dd></div>
            <div><dt>Phone</dt><dd>${escapeHtml(member.phone)}</dd></div>
            <div class="address-fact"><dt>Address</dt><dd>${escapeHtml(member.address)}</dd></div>
          </dl>
          <div class="member-actions">
            <a class="button secondary compact-button" href="/automation?edit=${encodeURIComponent(member.memberId)}#member-editor">Edit</a>
            <a class="button secondary compact-button ambiguity-control" data-ambiguity-control href="/automation?edit=${encodeURIComponent(member.memberId)}#member-editor" ${ambiguityActive ? "" : "hidden"}>Edit</a>
            <form class="delete-member-form" method="post" action="/automation/members/${encodeURIComponent(member.memberId)}/delete" data-member-name="${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}">
              <button class="danger-secondary compact-button" type="submit">Remove</button>
            </form>
          </div>
        </article>`,
      )
      .join("")}
  </div>`;
}

function renderWorkspaceSearch(query: string, resultCount: number): string {
  const summary =
    query.length === 0
      ? "Search by member ID, name, email, or phone."
      : `${resultCount} matching member${resultCount === 1 ? "" : "s"} for “${query}”.`;
  return `<form class="workspace-search" role="search" method="get" action="/automation">
    <label for="workspace-member-search">Search members</label>
    <div class="field-row">
      <input id="workspace-member-search" name="q" value="${escapeHtml(query)}" placeholder="Member ID, name, email, or phone">
      <button type="submit">Search</button>
      ${query.length === 0 ? "" : '<a class="button secondary" href="/automation">Clear</a>'}
    </div>
    <p class="search-summary" role="status">${escapeHtml(summary)}</p>
  </form>`;
}

function renderWorkspaceEditor(editor: AutomationWorkspaceEditor): string {
  const isCreate = editor.mode === "create";
  const errors = editor.errors ?? {};
  const formError = editor.formError ?? "";
  const title = isCreate
    ? "Add a member"
    : `Edit ${editor.member.firstName} ${editor.member.lastName}`;
  const action = isCreate
    ? "/automation/members"
    : `/automation/members/${encodeURIComponent(editor.member.memberId)}`;
  const summary =
    formError.length === 0 && Object.keys(errors).length === 0
      ? ""
      : `<section class="error-summary" role="alert"><h3>Member was not saved</h3><p>${escapeHtml(formError || "Correct the highlighted fields and try again.")}</p></section>`;

  return `<section id="member-editor" class="workspace-editor" aria-labelledby="member-editor-title">
    <div class="panel-heading"><div><p class="eyebrow">Manual controls</p><h3 id="member-editor-title">${escapeHtml(title)}</h3></div><a href="/automation">Close</a></div>
    ${summary}
    <form method="post" action="${action}" aria-label="${isCreate ? "Add member" : "Edit member"}" autocomplete="off">
      ${isCreate ? '<p class="field-help">The member ID is generated automatically.</p>' : renderInput("memberId", "Member ID", editor.member.memberId, errors.memberId, true)}
      <div class="editor-fields">
        ${renderInput("firstName", "First name", editor.member.firstName, errors.firstName)}
        ${renderInput("lastName", "Last name", editor.member.lastName, errors.lastName)}
        ${renderInput("email", "Email", editor.member.email, errors.email, false, "member@example.test", "email")}
        ${renderInput("phone", "Phone", editor.member.phone, errors.phone, false, "555-0100", "tel")}
      </div>
      <div class="field ${errors.address === undefined ? "" : "field-error"}">
        <label for="address">Address</label>
        <textarea id="address" name="address" rows="2" aria-describedby="${errors.address === undefined ? "" : "address-error"}">${escapeHtml(editor.member.address)}</textarea>
        ${renderError("address", errors.address)}
      </div>
      ${isCreate ? "" : renderSensitiveEditField({ ssnOnFile: editor.ssnOnFile ?? false, invalidSsn: editor.invalidSsn ?? false })}
      <div class="actions"><button type="submit">${isCreate ? "Create member" : "Save member"}</button><a class="button secondary" href="/automation">Cancel</a></div>
    </form>
  </section>`;
}

function renderScenarioOption(
  scenario: ScenarioName,
  activeScenario: ScenarioName,
  description: string,
): string {
  const id = `scenario-${scenario}`;
  return `<label class="scenario-option" for="${id}">
    <input id="${id}" name="scenario" type="radio" value="${scenario}" ${scenario === activeScenario ? "checked" : ""}>
    <span><strong>${escapeHtml(scenario)}</strong><small>${escapeHtml(description)}</small></span>
  </label>`;
}

function renderEmptyAutomationResult(): string {
  return `<div class="empty-result">
    <p>No command has run yet.</p>
    <p>The result appears here with its classification, capability, extracted inputs, evidence path, and a plain-language explanation.</p>
  </div>`;
}

function renderAutomationResult(run: AutomationRunView): string {
  const resultClass = `result-${run.resultKind.replace("_", "-")}`;
  return `<article class="automation-result ${resultClass}" aria-label="Automation result">
    <div class="result-heading"><span class="result-kind">${escapeHtml(run.resultKind.replace("_", " "))}</span><code>${escapeHtml(run.code)}</code></div>
    <h3>${escapeHtml(run.heading)}</h3>
    <p>${escapeHtml(run.explanation)}</p>
    ${renderHandoffNextStep(run)}
    <dl class="run-facts">
      <div><dt>Capability</dt><dd>${escapeHtml(run.capabilityId ?? "None selected")}</dd></div>
      <div><dt>Scenario</dt><dd>${escapeHtml(run.scenario)}</dd></div>
      ${Object.entries(run.extractedInputs)
        .map(
          ([key, value]) =>
            `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`,
        )
        .join("")}
      <div><dt>Model calls during replay</dt><dd>${run.modelCallCount}</dd></div>
      <div><dt>Run ID</dt><dd><code>${escapeHtml(run.runId)}</code></dd></div>
      <div><dt>Evidence</dt><dd>${run.evidenceDirectory === undefined ? "No browser run was needed" : `<code>${escapeHtml(run.evidenceDirectory)}</code>`}</dd></div>
    </dl>
  </article>`;
}

function renderHandoffNextStep(run: AutomationRunView): string {
  if (
    run.resultKind !== "pending_escalation" ||
    run.capabilityId !== "contact.update-ssn"
  ) {
    return "";
  }
  const memberId = run.extractedInputs.memberId;
  const command =
    memberId === undefined
      ? "npm run handoff"
      : `npm run handoff -- --member-id ${memberId}`;
  return `<section class="handoff-next-step" aria-labelledby="handoff-next-title">
    <p class="eyebrow">Next step</p>
    <h4 id="handoff-next-title">Complete the protected action as a human</h4>
    <p>Run this command in a terminal from the repository root. It opens an isolated two-tab browser session and does not require an API key.</p>
    <div class="handoff-command"><code>${escapeHtml(command)}</code><button class="secondary compact-button" type="button" data-copy-command="${escapeHtml(command)}">Copy command</button></div>
    <p class="copy-status" data-copy-status aria-live="polite"></p>
    <ol>
      <li>Select <strong>Claim browser</strong> in the Human handoff tab.</li>
      <li>Enter a synthetic SSN in the existing Contacts tab and save.</li>
      <li>Select <strong>Release and request verified resume</strong>.</li>
    </ol>
  </section>`;
}

export function renderContactsList(
  members: Member[],
  query: string,
  scenario: ScenarioName,
): string {
  const results =
    members.length === 0
      ? `<section class="notice" role="status">
          <h2>No contacts found</h2>
          <p>No member matched “${escapeHtml(query)}”. Check the identifier or search again.</p>
        </section>`
      : `<div class="desktop-results table-wrap">
          <table>
            <caption>${members.length} member${members.length === 1 ? "" : "s"} found</caption>
            <thead>
              <tr><th scope="col">Member ID</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              ${members.map((member) => renderMemberRow(member, scenario)).join("\n")}
            </tbody>
          </table>
        </div>
        <div class="mobile-results" aria-label="Member search results">
          ${members.map((member) => renderMemberCard(member, scenario)).join("\n")}
        </div>`;

  return renderLayout(
    "Contacts",
    `<div class="page-heading">
      <div><p class="eyebrow">Operations</p><h1>Member contacts</h1></div>
      <a class="button" href="/contacts/new">Add contact</a>
    </div>
    <form class="search" role="search" method="get" action="/contacts">
      <label for="member-search">Member search</label>
      <div class="field-row">
        <input id="member-search" name="q" value="${escapeHtml(query)}" placeholder="Member ID, name, email, or phone">
        <button type="submit">Search</button>
      </div>
    </form>
    ${results}
    ${scenario === "unexpected-dialog" ? renderUnexpectedDialog(`/contacts${query.length === 0 ? "" : `?q=${encodeURIComponent(query)}`}`) : ""}`,
  );
}

export function renderMemberDetails(
  member: Member,
  message = "",
  scenario: ScenarioName = "normal",
): string {
  const status =
    message.length === 0
      ? ""
      : `<p class="success" role="status">${escapeHtml(message)}</p>`;

  return renderLayout(
    `${member.firstName} ${member.lastName}`,
    `<nav aria-label="Breadcrumb"><a href="/contacts">Contacts</a> / ${escapeHtml(member.memberId)}</nav>
    ${status}
    <div class="page-heading">
      <div><p class="eyebrow">${escapeHtml(member.memberId)}</p><h1>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</h1></div>
      <div class="actions">
        <a class="button" href="/contacts/${encodeURIComponent(member.memberId)}/edit">Edit contact</a>
        ${scenario === "ambiguous-actions" ? `<a class="button" href="/contacts/${encodeURIComponent(member.memberId)}/edit">Edit contact</a>` : ""}
        <a class="button danger-secondary" href="/contacts/${encodeURIComponent(member.memberId)}/delete">Delete contact</a>
      </div>
    </div>
    <dl class="details">
      <div><dt>Email</dt><dd>${escapeHtml(member.email)}</dd></div>
      <div><dt>Phone</dt><dd>${escapeHtml(member.phone)}</dd></div>
      <div><dt>Address</dt><dd>${escapeHtml(member.address)}</dd></div>
      <div><dt>SSN</dt><dd>${member.ssnOnFile ? "On file" : "Not on file"}</dd></div>
    </dl>
    ${scenario === "unexpected-dialog" ? renderUnexpectedDialog(`/contacts/${encodeURIComponent(member.memberId)}`) : ""}`,
  );
}

export function renderTransientFailure(query: string): string {
  return renderLayout(
    "Temporarily unavailable",
    `<section class="notice transient" role="alert">
      <p class="eyebrow">Recoverable condition</p>
      <h1>Search temporarily unavailable</h1>
      <p>The directory did not finish loading. No action was applied.</p>
      <a class="button" href="/contacts?q=${encodeURIComponent(query)}">Try search again</a>
    </section>`,
  );
}

export function renderScenarioControls(active: ScenarioName): string {
  return renderLayout(
    "Scenario controls",
    `<nav aria-label="Breadcrumb"><a href="/contacts">Contacts</a> / Scenarios</nav>
    <h1>Scenario controls</h1>
    <p>Activate one deterministic UI condition at a time. Resetting application data also restores the normal scenario.</p>
    <p class="scenario-current" role="status">Current scenario: <strong>${escapeHtml(active)}</strong></p>
    <div class="scenario-grid">
      ${scenarioNames.map((scenario) => renderScenarioButton(scenario, scenario === active)).join("\n")}
    </div>`,
  );
}

export function renderMemberForm(
  mode: "create" | "edit",
  member: MemberInput,
  errors: ValidationErrors = {},
  formError = "",
  sensitiveState: { ssnOnFile: boolean; invalidSsn: boolean } = {
    ssnOnFile: false,
    invalidSsn: false,
  },
): string {
  const isCreate = mode === "create";
  const title = isCreate
    ? "Add contact"
    : `Edit ${member.firstName} ${member.lastName}`;
  const action = isCreate
    ? "/contacts"
    : `/contacts/${encodeURIComponent(member.memberId)}`;

  const summary =
    formError.length === 0 && Object.keys(errors).length === 0
      ? ""
      : `<section class="error-summary" role="alert"><h2>Contact was not saved</h2><p>${escapeHtml(formError || "Correct the highlighted fields and try again.")}</p></section>`;

  return renderLayout(
    title,
    `<nav aria-label="Breadcrumb"><a href="/contacts">Contacts</a> / ${isCreate ? "New" : escapeHtml(member.memberId)}</nav>
    <h1>${escapeHtml(title)}</h1>
    ${summary}
    <form class="member-form" method="post" action="${action}" aria-label="${isCreate ? "Add member" : "Edit member"}" autocomplete="off">
      ${isCreate ? '<p class="field-help">A member ID will be generated automatically when this contact is created.</p>' : renderInput("memberId", "Member ID", member.memberId, errors.memberId, true)}
      ${renderInput("firstName", "First name", member.firstName, errors.firstName)}
      ${renderInput("lastName", "Last name", member.lastName, errors.lastName)}
      ${renderInput("email", "Email", member.email, errors.email, false, "member@example.test", "email")}
      ${renderInput("phone", "Phone", member.phone, errors.phone, false, "555-0100", "tel")}
      <div class="field ${errors.address === undefined ? "" : "field-error"}">
        <label for="address">Address</label>
        <textarea id="address" name="address" rows="3" aria-describedby="${errors.address === undefined ? "" : "address-error"}">${escapeHtml(member.address)}</textarea>
        ${renderError("address", errors.address)}
      </div>
      ${isCreate ? "" : renderSensitiveEditField(sensitiveState)}
      <div class="actions">
        <button type="submit">${isCreate ? "Create contact" : "Save changes"}</button>
        <a class="button secondary" href="${isCreate ? "/contacts" : `/contacts/${encodeURIComponent(member.memberId)}`}">Cancel</a>
      </div>
    </form>`,
  );
}

function renderSensitiveEditField(state: {
  ssnOnFile: boolean;
  invalidSsn: boolean;
}): string {
  return `<section class="sensitive-notice" role="note">
    <h2>Social Security number</h2>
    <p>Human entry only. Current status: <strong>${state.ssnOnFile ? "On file" : "Not on file"}</strong>.</p>
    <div class="field ${state.invalidSsn ? "field-error" : ""}">
      <label for="ssn">Social Security number (human entry only)</label>
      <input id="ssn" name="ssn" type="password" inputmode="numeric" pattern="[0-9]{3}-?[0-9]{2}-?[0-9]{4}" autocomplete="new-password" aria-describedby="ssn-help${state.invalidSsn ? " ssn-error" : ""}">
      <p id="ssn-help" class="field-help">Leave blank to keep the current status. A submitted value is immediately discarded; only “on file” is retained.</p>
      ${state.invalidSsn ? '<p id="ssn-error" class="field-error-message">Enter a nine-digit value in the requested format.</p>' : ""}
    </div>
  </section>`;
}

export function renderDeleteConfirmation(member: Member): string {
  return renderLayout(
    "Delete contact",
    `<nav aria-label="Breadcrumb"><a href="/contacts">Contacts</a> / <a href="/contacts/${encodeURIComponent(member.memberId)}">${escapeHtml(member.memberId)}</a> / Delete</nav>
    <section class="danger-zone">
      <h1>Delete contact</h1>
      <p>This will permanently remove <strong>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</strong> from the synthetic directory.</p>
      <form method="post" action="/contacts/${encodeURIComponent(member.memberId)}/delete">
        <button class="danger" type="submit">Confirm delete</button>
        <a class="button secondary" href="/contacts/${encodeURIComponent(member.memberId)}">Cancel</a>
      </form>
    </section>`,
  );
}

export function renderNotFound(memberId: string): string {
  return renderLayout(
    "Contact not found",
    `<section class="notice" role="status">
      <h1>Contact not found</h1>
      <p>No contact exists with member ID ${escapeHtml(memberId)}.</p>
      <a class="button" href="/contacts">Return to contacts</a>
    </section>`,
  );
}

export const styles = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #18212f; background: #f4f6f8; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; }
a { color: #164b8a; }
.site-header { min-height: 68px; padding: 16px clamp(18px, 4vw, 48px); background: #12345a; color: white; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.brand { color: white; font-size: 1.1rem; font-weight: 750; text-decoration: none; }
.environment { font-size: .85rem; opacity: .8; }
.header-tools { display: flex; align-items: center; gap: 18px; }
.header-tools a { color: white; }
main { width: min(1480px, calc(100% - 32px)); margin: 32px auto 72px; }
.page-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin: 20px 0; }
h1 { margin: 4px 0 16px; font-size: clamp(1.8rem, 4vw, 2.5rem); }
.eyebrow { margin: 0; color: #526176; font-size: .8rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.search, .member-form, .details, .notice, .danger-zone { background: white; border: 1px solid #d8dee7; border-radius: 8px; padding: 22px; box-shadow: 0 2px 8px rgb(24 33 47 / 6%); }
.search { margin-bottom: 24px; }
.search label, .field label { display: block; margin-bottom: 7px; font-weight: 700; }
.field-row { display: flex; gap: 8px; }
input, textarea { width: 100%; border: 1px solid #8996a8; border-radius: 5px; padding: 10px 11px; font: inherit; }
input:focus, textarea:focus, button:focus, a:focus { outline: 3px solid #f5bf42; outline-offset: 2px; }
input[readonly] { background: #edf0f4; color: #4c596b; }
button, .button { display: inline-block; border: 1px solid #164b8a; border-radius: 5px; padding: 10px 14px; background: #164b8a; color: white; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
button:disabled { border-color: #9aa5b3; background: #9aa5b3; cursor: not-allowed; opacity: .72; }
.secondary, .danger-secondary { background: white; color: #164b8a; }
.danger, .danger-secondary { border-color: #a32828; }
.danger { background: #a32828; }
.danger-secondary { color: #8e2020; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.table-wrap { overflow-x: auto; background: white; border: 1px solid #d8dee7; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
caption { padding: 12px 16px; text-align: left; color: #526176; }
th, td { border-top: 1px solid #d8dee7; padding: 13px 16px; text-align: left; vertical-align: top; }
th { background: #edf2f7; font-size: .85rem; }
.details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.details div { min-width: 0; }
dt { color: #526176; font-size: .8rem; font-weight: 750; text-transform: uppercase; }
dd { margin: 6px 0 0; overflow-wrap: anywhere; }
.member-form { max-width: 680px; }
.field { margin-bottom: 18px; }
.field-error input, .field-error textarea { border-color: #a32828; }
.field-error-message { margin: 6px 0 0; color: #8e2020; font-weight: 650; }
.error-summary { max-width: 680px; margin-bottom: 16px; border-left: 5px solid #a32828; background: #fff0f0; padding: 14px 18px; }
.error-summary h2 { margin: 0 0 6px; font-size: 1.1rem; }
.error-summary p { margin: 0; }
.success { border-left: 5px solid #247a43; background: #eaf7ef; padding: 12px 16px; }
.sensitive-notice { max-width: 680px; margin-bottom: 16px; border-left: 5px solid #b46c00; background: #fff6df; padding: 14px 18px; }
.sensitive-notice h2 { margin: 0 0 6px; font-size: 1.1rem; }
.sensitive-notice p, .field-help { margin: 6px 0 0; color: #4c596b; }
.danger-zone { max-width: 700px; border-top: 5px solid #a32828; }
.transient { border-top: 5px solid #b46c00; }
.mobile-results { display: none; }
.member-card { background: white; border: 1px solid #d8dee7; border-radius: 8px; padding: 18px; margin-bottom: 12px; }
.member-card h2 { margin: 0 0 8px; }
.member-card p { margin: 5px 0; overflow-wrap: anywhere; }
.member-card details { margin-top: 14px; }
.member-card summary { color: #164b8a; cursor: pointer; font-weight: 750; }
.member-card .mobile-actions { display: flex; flex-direction: column; align-items: start; gap: 10px; padding: 12px 0 2px; }
.scenario-current { border-left: 5px solid #164b8a; background: white; padding: 12px 16px; }
.scenario-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.scenario-card { background: white; border: 1px solid #d8dee7; border-radius: 8px; padding: 18px; }
.scenario-card h2 { margin-top: 0; font-size: 1.1rem; }
.scenario-card form { margin-top: 12px; }
.console-heading, .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.console-intro { max-width: 860px; margin: -4px 0 24px; color: #3f4d60; font-size: 1.05rem; line-height: 1.6; }
.mode-badge { border: 1px solid #8ab3dc; border-radius: 999px; background: #eaf4ff; color: #123f70; padding: 7px 11px; font-size: .82rem; font-weight: 750; white-space: nowrap; }
.lifecycle { margin-bottom: 22px; border: 1px solid #c8d0da; border-top: 5px solid #164b8a; border-radius: 9px; background: white; padding: 20px; box-shadow: 0 2px 8px rgb(24 33 47 / 6%); }
.lifecycle-heading, .phase-panel-heading { display: flex; align-items: start; justify-content: space-between; gap: 14px; }
.lifecycle-heading h2 { margin: 3px 0 14px; font-size: 1.35rem; }
.phase-status { border-radius: 999px; background: #eaf4ff; color: #123f70; padding: 7px 11px; font-size: .8rem; font-weight: 800; white-space: nowrap; }
.phase-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.phase-card { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-items: center; min-width: 0; border: 1px solid #d8dee7; border-radius: 7px; padding: 12px; }
.phase-card strong, .phase-card small { display: block; }
.phase-card strong { font-size: .9rem; }
.phase-card small { margin-top: 3px; color: #526176; font-size: .78rem; line-height: 1.35; }
.phase-number { grid-row: 1 / 3; display: grid; width: 30px; height: 30px; place-items: center; border-radius: 50%; background: #dfe5ec; color: #405168; font-size: .82rem; font-weight: 850; }
.phase-state { grid-column: 2; color: #6a7686; font-size: .68rem; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
.phase-active { border-color: #4d87c3; background: #f2f8ff; box-shadow: inset 0 0 0 1px #4d87c3; }
.phase-active .phase-number { background: #164b8a; color: white; }
.phase-complete { border-color: #80b894; background: #f0f8f3; }
.phase-complete .phase-number { background: #247a43; color: white; }
.phase-complete .phase-state { color: #176037; }
.phase-locked { background: #f7f8fa; color: #637083; }
.terminology-note { margin: 14px 0 0; color: #526176; font-size: .82rem; line-height: 1.5; }
.lifecycle-error { margin: 14px 0 0; border-left: 5px solid #a32828; background: #fff0f0; padding: 11px 13px; }
.global-notice { margin: 0 0 20px; }
.workspace-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(390px, .85fr); gap: 20px; align-items: start; }
.console-panel { background: white; border: 1px solid #d8dee7; border-radius: 8px; padding: 22px; box-shadow: 0 2px 8px rgb(24 33 47 / 6%); }
.console-panel h2 { margin: 2px 0 16px; font-size: 1.3rem; }
.console-panel h3 { margin: 14px 0 7px; }
.panel-intro { margin: 0 0 16px; color: #526176; line-height: 1.5; }
.workspace-search { margin: 0 0 16px; border: 1px solid #c8d7e7; border-radius: 7px; background: #f4f8fc; padding: 14px; }
.workspace-search label { display: block; margin-bottom: 7px; font-weight: 750; }
.workspace-search input { min-width: 0; }
.workspace-search .field-row { align-items: stretch; }
.workspace-search .button { text-align: center; white-space: nowrap; }
.search-summary { margin: 8px 0 0; color: #526176; font-size: .82rem; }
.workspace-empty { box-shadow: none; }
.testing-column { min-width: 0; }
.testing-column > .console-panel + .console-panel { margin-top: 16px; }
.phase-work-panel { border-top: 4px solid #4d87c3; }
.phase-work-panel h2 { margin-top: 3px; }
.phase-complete-panel { border-top-color: #247a43; }
.phase-locked-panel { border-top-color: #aeb7c3; background: #fafbfc; }
.configuration-ready, .configuration-missing, .call-count, .draft-badge, .approved-badge { border-radius: 999px; padding: 6px 9px; font-size: .72rem; font-weight: 800; white-space: nowrap; }
.configuration-ready, .approved-badge { background: #e4f5ea; color: #176037; }
.configuration-missing { background: #fff1df; color: #894b05; }
.model-calls { background: #f0e9ff; color: #55309a; }
.zero-calls { background: #e4f5ea; color: #176037; }
.draft-badge { background: #fff4d7; color: #765405; }
.discovery-goal { border-left: 4px solid #7c54bd; background: #f7f3ff; padding: 10px 12px; line-height: 1.45; }
.trace-steps { margin: 15px 0; padding: 0; list-style: none; }
.trace-steps li { display: flex; gap: 10px; align-items: center; border-top: 1px solid #e0e5ec; padding: 9px 0; }
.trace-steps li:first-child { border-top: 0; }
.trace-steps strong, .trace-steps small { display: block; }
.trace-steps small { margin-top: 2px; color: #526176; }
.trace-step-number { display: grid; width: 25px; height: 25px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #ece5f8; color: #55309a; font-size: .75rem; font-weight: 850; }
.artifact-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; margin: 14px 0; }
.artifact-facts div { min-width: 0; border-radius: 5px; background: #f3f6f9; padding: 10px; }
.artifact-facts .wide-fact { grid-column: 1 / -1; }
.artifact-facts code { overflow-wrap: anywhere; }
.approval-form { border-top: 1px solid #d8dee7; margin-top: 14px; padding-top: 14px; }
.approval-form .field { margin-bottom: 11px; }
.locked-message { margin: 10px 0 0; color: #526176; font-size: .86rem; line-height: 1.45; }
.capability-catalog { margin: 0 0 18px; border: 1px solid #c8d0da; border-radius: 6px; background: #f7f9fb; }
.capability-catalog summary { padding: 10px 12px; color: #164b8a; cursor: pointer; font-weight: 750; }
.capability-catalog > div { border-top: 1px solid #d8dee7; padding: 10px 12px; }
.capability-catalog p { margin: 5px 0 0; color: #526176; font-size: .82rem; line-height: 1.45; }
.capability-catalog .catalog-api { border-top: 1px solid #d8dee7; margin: 0; padding: 10px 12px; }
.compact-button { padding: 7px 10px; font-size: .85rem; }
.workspace-members { display: grid; gap: 12px; }
.scenario-preview { margin: 0 0 14px; border-left: 4px solid #b46c00; background: #fff6df; padding: 10px 12px; color: #694300; }
.workspace-member { border: 1px solid #d8dee7; border-radius: 7px; padding: 16px; background: #fbfcfd; }
.member-summary { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.member-summary h3 { margin: 3px 0 0; font-size: 1.08rem; }
.member-id { color: #526176; font-size: .78rem; font-weight: 800; letter-spacing: .05em; }
.ssn-status { border-radius: 999px; background: #edf2f7; padding: 5px 8px; color: #405168; font-size: .76rem; font-weight: 700; white-space: nowrap; }
.member-facts { display: grid; grid-template-columns: 1.25fr .75fr; gap: 12px; margin: 15px 0; }
.member-facts .address-fact { grid-column: 1 / -1; }
.member-facts div { min-width: 0; }
.member-actions { display: flex; gap: 8px; }
.delete-member-form { margin: 0; }
.workspace-editor { margin-top: 18px; border-top: 4px solid #164b8a; border-radius: 7px; background: #f5f8fb; padding: 18px; scroll-margin-top: 18px; }
.workspace-editor .panel-heading { margin-bottom: 14px; }
.workspace-editor .panel-heading h3 { margin: 3px 0 0; }
.editor-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
.step-number { display: inline-grid; width: 26px; height: 26px; margin: 0 0 5px; border-radius: 50%; place-items: center; background: #12345a; color: white; font-size: .8rem; font-weight: 800; }
.example-row { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: -5px 0 20px; color: #526176; font-size: .86rem; }
.example-command { padding: 5px 8px; background: white; color: #164b8a; font-size: .82rem; font-weight: 650; }
.scenario-picker { margin: 0 0 20px; border: 1px solid #d8dee7; border-radius: 7px; padding: 12px; }
.scenario-picker legend { padding: 0 6px; font-weight: 750; }
.scenario-option { display: flex; align-items: start; gap: 10px; border-radius: 5px; padding: 9px; cursor: pointer; }
.scenario-option:hover { background: #f1f6fb; }
.scenario-option input { width: auto; margin-top: 4px; }
.scenario-option span, .scenario-option small { display: block; }
.scenario-option small { margin-top: 2px; color: #526176; }
.run-progress { min-height: 1.4em; margin: 12px 0 0; color: #164b8a; font-weight: 700; }
.result-panel { position: static; }
.empty-result { border: 2px dashed #c8d0da; border-radius: 7px; padding: 18px; color: #526176; }
.automation-result { border-left: 6px solid #526176; border-radius: 5px; background: #f7f9fb; padding: 16px; }
.result-success { border-color: #247a43; background: #edf8f1; }
.result-business-outcome { border-color: #8a6712; background: #fff9e9; }
.result-pending-escalation { border-color: #9a5607; background: #fff3df; }
.result-hard-failure { border-color: #a32828; background: #fff0f0; }
.result-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.result-kind { text-transform: uppercase; letter-spacing: .06em; font-size: .76rem; font-weight: 850; }
.handoff-next-step { margin: 16px 0 4px; border: 1px solid #e2bd72; border-radius: 7px; background: #fffaf0; padding: 14px; }
.handoff-next-step h4 { margin: 4px 0 8px; font-size: 1rem; }
.handoff-next-step > p:not(.eyebrow, .copy-status) { margin: 0 0 10px; color: #4c596b; line-height: 1.45; }
.handoff-next-step ol { margin: 12px 0 0; padding-left: 22px; }
.handoff-next-step li + li { margin-top: 6px; }
.handoff-command { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #d7b36d; border-radius: 5px; background: white; padding: 9px 10px; }
.handoff-command code { min-width: 0; overflow-wrap: anywhere; }
.copy-status { min-height: 1em; margin: 5px 0 0; color: #176037; font-size: .78rem; font-weight: 700; }
.run-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 18px 0 0; }
.run-facts div { min-width: 0; }
.run-facts code { overflow-wrap: anywhere; }
.data-panel, .outcome-guide { margin-top: 18px; }
.data-panel .table-wrap { margin-top: 14px; box-shadow: none; }
.outcome-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
.outcome-grid > div { border: 1px solid #d8dee7; border-radius: 6px; padding: 12px; }
.outcome-grid p { margin: 7px 0 0; color: #526176; font-size: .88rem; line-height: 1.45; }
.outcome { font-size: .87rem; }
.success-tone { color: #176037; }
.business-tone { color: #765405; }
.recovery-tone { color: #165a82; }
.failure-tone { color: #8e2020; }
.handoff-tone { color: #894b05; }
.advanced-link { margin: 18px 0 0; color: #526176; }
.dialog-backdrop { position: fixed; inset: 0; background: rgb(11 24 39 / 65%); display: grid; place-items: center; padding: 18px; z-index: 10; }
.unexpected-dialog { width: min(520px, 100%); background: white; border: 0; border-radius: 8px; padding: 24px; box-shadow: 0 18px 60px rgb(0 0 0 / 35%); }
.unexpected-dialog h2 { margin-top: 0; }
nav { margin-bottom: 20px; color: #526176; }
@media (max-width: 1050px) {
  .details { grid-template-columns: repeat(2, 1fr); }
  .workspace-grid { grid-template-columns: 1fr; }
  .outcome-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 680px) {
  .site-header, .page-heading, .field-row, .console-heading, .panel-heading, .lifecycle-heading, .phase-panel-heading { align-items: stretch; flex-direction: column; }
  .header-tools { align-items: start; flex-direction: column; gap: 8px; }
  .environment { display: none; }
  .details { grid-template-columns: 1fr; }
  .desktop-results { display: none; }
  .mobile-results { display: block; }
  .scenario-grid { grid-template-columns: 1fr; }
  .run-facts, .outcome-grid { grid-template-columns: 1fr; }
  .member-summary { align-items: stretch; flex-direction: column; }
  .ssn-status { align-self: start; }
  .member-facts, .editor-fields { grid-template-columns: 1fr; }
  .member-facts .address-fact { grid-column: auto; }
  .handoff-command { align-items: stretch; flex-direction: column; }
  .mode-badge { align-self: start; white-space: normal; }
  .phase-strip, .artifact-facts { grid-template-columns: 1fr; }
  .artifact-facts .wide-fact { grid-column: auto; }
  .phase-status, .configuration-ready, .configuration-missing, .call-count, .draft-badge, .approved-badge { align-self: start; white-space: normal; }
  main { margin-top: 20px; }
}
`;

export const automationClientScript = `
const form = document.querySelector("#automation-command-form");
const instruction = document.querySelector("#instruction");
const progress = document.querySelector("#automation-progress");
for (const button of document.querySelectorAll("[data-command]")) {
  button.addEventListener("click", () => {
    if (instruction instanceof HTMLTextAreaElement) {
      instruction.value = button.getAttribute("data-command") ?? "";
      instruction.focus();
    }
  });
}
for (const copyButton of document.querySelectorAll("[data-copy-command]")) {
  copyButton.addEventListener("click", async () => {
    const command = copyButton.getAttribute("data-copy-command") ?? "";
    const status = copyButton.closest(".handoff-next-step")?.querySelector("[data-copy-status]");
    try {
      await navigator.clipboard.writeText(command);
      if (status instanceof HTMLElement) status.textContent = "Command copied.";
    } catch {
      if (status instanceof HTMLElement) status.textContent = "Select and copy the command shown above.";
    }
  });
}
const scenarioInputs = document.querySelectorAll('input[name="scenario"]');
function syncScenarioPreview() {
  const selected = document.querySelector('input[name="scenario"]:checked');
  const ambiguityActive = selected instanceof HTMLInputElement && selected.value === "ambiguous-actions";
  for (const control of document.querySelectorAll("[data-ambiguity-control]")) {
    control.toggleAttribute("hidden", !ambiguityActive);
  }
  for (const note of document.querySelectorAll("[data-ambiguity-note]")) {
    note.toggleAttribute("hidden", !ambiguityActive);
  }
}
for (const scenarioInput of scenarioInputs) {
  scenarioInput.addEventListener("change", syncScenarioPreview);
}
syncScenarioPreview();
form?.addEventListener("submit", (event) => {
  const submitter = event.submitter;
  if (!(submitter instanceof HTMLButtonElement) || submitter.id !== "run-automation") return;
  submitter.setAttribute("aria-disabled", "true");
  submitter.textContent = "Running…";
  form.setAttribute("aria-busy", "true");
  if (progress instanceof HTMLElement) {
    progress.textContent = "Resolving the approved capability, driving the browser, and verifying the checkpoint…";
  }
});
const discoveryForm = document.querySelector("#discovery-form");
discoveryForm?.addEventListener("submit", () => {
  const button = document.querySelector("#run-discovery");
  const discoveryProgress = document.querySelector("#discovery-progress");
  if (button instanceof HTMLButtonElement) {
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Discovering…";
  }
  discoveryForm.setAttribute("aria-busy", "true");
  if (discoveryProgress instanceof HTMLElement) {
    discoveryProgress.textContent = "The LLM is observing and choosing bounded semantic actions. This can take about a minute…";
  }
});
for (const resetForm of document.querySelectorAll(".demo-reset-form")) {
  resetForm.addEventListener("submit", (event) => {
    if (!window.confirm("Reset contacts and return this demo to Phase 1? Audit evidence will remain on disk.")) {
      event.preventDefault();
    }
  });
}
for (const deleteForm of document.querySelectorAll(".delete-member-form")) {
  deleteForm.addEventListener("submit", (event) => {
    const name = deleteForm.getAttribute("data-member-name") ?? "this member";
    if (!window.confirm("Remove " + name + " from the synthetic directory?")) {
      event.preventDefault();
    }
  });
}
`;

function renderMemberRow(member: Member, scenario: ScenarioName): string {
  const memberUrl = `/contacts/${encodeURIComponent(member.memberId)}`;
  const editLink = `<a href="${memberUrl}/edit">Edit</a>`;
  return `<tr>
    <th scope="row"><a href="${memberUrl}">${escapeHtml(member.memberId)}</a></th>
    <td>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</td>
    <td>${escapeHtml(member.email)}</td>
    <td>${escapeHtml(member.phone)}</td>
    <td>${editLink}${scenario === "ambiguous-actions" ? ` ${editLink}` : ""}</td>
  </tr>`;
}

function renderMemberCard(member: Member, scenario: ScenarioName): string {
  const memberUrl = `/contacts/${encodeURIComponent(member.memberId)}`;
  const editLink = `<a href="${memberUrl}/edit">Edit contact</a>`;
  return `<article class="member-card">
    <p class="eyebrow">${escapeHtml(member.memberId)}</p>
    <h2><a href="${memberUrl}" aria-label="View contact ${escapeHtml(member.memberId)}">${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</a></h2>
    <p>${escapeHtml(member.email)}</p>
    <p>${escapeHtml(member.phone)}</p>
    <details>
      <summary>Actions</summary>
      <div class="mobile-actions">${editLink}${scenario === "ambiguous-actions" ? editLink : ""}<a href="${memberUrl}">View contact</a></div>
    </details>
  </article>`;
}

function renderUnexpectedDialog(returnTo: string): string {
  return `<div class="dialog-backdrop">
    <section class="unexpected-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <p class="eyebrow">Unexpected interstitial</p>
      <h2 id="dialog-title">Session notice</h2>
      <p>A legacy session notice interrupted the workflow. Dismiss it before continuing.</p>
      <form method="post" action="/admin/scenario/dismiss">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
        <button type="submit">Dismiss notice</button>
      </form>
    </section>
  </div>`;
}

function renderScenarioButton(scenario: ScenarioName, active: boolean): string {
  const descriptions: Record<ScenarioName, string> = {
    normal: "Standard application behavior with no injected fault.",
    "ambiguous-actions":
      "Duplicates visible Edit controls to test fail-closed cardinality.",
    "transient-search":
      "Returns one recoverable search failure, then succeeds on retry.",
    "unexpected-dialog":
      "Places a dismissible legacy session notice over the workflow.",
  };
  return `<section class="scenario-card">
    <h2>${escapeHtml(scenario)}</h2>
    <p>${escapeHtml(descriptions[scenario])}</p>
    <form method="post" action="/admin/scenario">
      <input type="hidden" name="scenario" value="${escapeHtml(scenario)}">
      <button type="submit" ${active ? "disabled" : ""}>${active ? "Active" : "Activate"}</button>
    </form>
  </section>`;
}

function renderInput(
  name: string,
  label: string,
  value: string,
  error?: string,
  readonly = false,
  placeholder = "",
  type = "text",
): string {
  return `<div class="field ${error === undefined ? "" : "field-error"}">
    <label for="${name}">${escapeHtml(label)}</label>
    <input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${readonly ? "readonly" : ""} aria-describedby="${error === undefined ? "" : `${name}-error`}">
    ${renderError(name, error)}
  </div>`;
}

function renderError(name: string, error?: string): string {
  return error === undefined
    ? ""
    : `<p class="field-error-message" id="${name}-error">${escapeHtml(error)}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}
