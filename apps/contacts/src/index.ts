export { createContactsApp, type ContactsAppDependencies } from "./app.js";
export {
  AutomationConsole,
  CapabilityInvocationError,
  getCapabilityCatalog,
  parseCapabilityInvocation,
  parseAutomationInstruction,
  type AutomationConsoleOptions,
  type AutomationConsolePort,
  type AutomationIntent,
  type AutomationRunView,
  type CapabilityCatalog,
  type CapabilityCatalogEntry,
  type CatalogCapabilityId,
  type CatalogValueDefinition,
} from "./automation.js";
export {
  DemoLifecycle,
  type DemoLifecycleOptions,
  type DemoLifecyclePort,
  type DemoLifecycleStatus,
  type DemoLifecycleView,
  type DiscoveryStepView,
} from "./demo-lifecycle.js";
export {
  normalizeMemberInput,
  readMemberForm,
  validateMemberInput,
  type Member,
  type MemberInput,
  type ValidationErrors,
} from "./member.js";
export { MemberRepository, type SaveResult } from "./repository.js";
export {
  isScenarioName,
  ScenarioController,
  scenarioNames,
  type ScenarioName,
} from "./scenarios.js";
