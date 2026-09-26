import type { Member, MemberInput, ValidationErrors } from "./member.js";
import { scenarioNames, type ScenarioName } from "./scenarios.js";

export function renderLayout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} | Member Contacts Admin</title>
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="/contacts">Northbank Member Contacts</a>
      <div class="header-tools"><span class="environment">Synthetic training environment</span><a href="/admin/scenarios">Scenario controls</a></div>
    </header>
    <main>${content}</main>
  </body>
</html>`;
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
        <a class="button secondary" href="/contacts/${encodeURIComponent(member.memberId)}/ssn">Update SSN</a>
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

export function renderSensitiveSsnForm(
  member: Member,
  invalid = false,
): string {
  return renderLayout(
    "Update SSN",
    `<nav aria-label="Breadcrumb"><a href="/contacts">Contacts</a> / <a href="/contacts/${encodeURIComponent(member.memberId)}">${escapeHtml(member.memberId)}</a> / Update SSN</nav>
    <h1>Update SSN</h1>
    <section class="sensitive-notice" role="note">
      <h2>Human entry required</h2>
      <p>This sensitive field must be completed by an authorized operator. Its value is never displayed again or retained by the training application.</p>
    </section>
    ${invalid ? '<section class="error-summary" role="alert"><h2>SSN was not saved</h2><p>Enter a nine-digit value in the requested format.</p></section>' : ""}
    <form class="member-form" method="post" action="/contacts/${encodeURIComponent(member.memberId)}/ssn" aria-label="Update member SSN" autocomplete="off">
      <div class="field ${invalid ? "field-error" : ""}">
        <label for="ssn">Social Security number</label>
        <input id="ssn" name="ssn" type="password" inputmode="numeric" pattern="[0-9]{3}-?[0-9]{2}-?[0-9]{4}" required aria-describedby="ssn-help">
        <p id="ssn-help" class="field-help">Accepted only for this request; the raw value is immediately discarded.</p>
      </div>
      <div class="actions">
        <button type="submit">Save SSN</button>
        <a class="button secondary" href="/contacts/${encodeURIComponent(member.memberId)}">Cancel</a>
      </div>
    </form>`,
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
    <form class="member-form" method="post" action="${action}" aria-label="${isCreate ? "Add member" : "Edit member"}">
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
      <div class="actions">
        <button type="submit">${isCreate ? "Create contact" : "Save changes"}</button>
        <a class="button secondary" href="${isCreate ? "/contacts" : `/contacts/${encodeURIComponent(member.memberId)}`}">Cancel</a>
      </div>
    </form>`,
  );
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
body { margin: 0; }
a { color: #164b8a; }
.site-header { min-height: 68px; padding: 16px clamp(18px, 4vw, 48px); background: #12345a; color: white; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.brand { color: white; font-size: 1.1rem; font-weight: 750; text-decoration: none; }
.environment { font-size: .85rem; opacity: .8; }
.header-tools { display: flex; align-items: center; gap: 18px; }
.header-tools a { color: white; }
main { width: min(1100px, calc(100% - 32px)); margin: 32px auto 72px; }
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
.dialog-backdrop { position: fixed; inset: 0; background: rgb(11 24 39 / 65%); display: grid; place-items: center; padding: 18px; z-index: 10; }
.unexpected-dialog { width: min(520px, 100%); background: white; border: 0; border-radius: 8px; padding: 24px; box-shadow: 0 18px 60px rgb(0 0 0 / 35%); }
.unexpected-dialog h2 { margin-top: 0; }
nav { margin-bottom: 20px; color: #526176; }
@media (max-width: 900px) {
  .details { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 680px) {
  .site-header, .page-heading, .field-row { align-items: stretch; flex-direction: column; }
  .header-tools { align-items: start; flex-direction: column; gap: 8px; }
  .environment { display: none; }
  .details { grid-template-columns: 1fr; }
  .desktop-results { display: none; }
  .mobile-results { display: block; }
  .scenario-grid { grid-template-columns: 1fr; }
  main { margin-top: 20px; }
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
    <h2><a href="${memberUrl}">${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</a></h2>
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
