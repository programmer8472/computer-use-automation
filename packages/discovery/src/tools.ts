import { z } from "zod";

import type { Action, TargetLocator } from "@computer-use/contracts";

import type { DiscoveryActionDecision, ModelToolCall } from "./types.js";

const clickArgumentsSchema = z.strictObject({
  role: z.enum(["button", "link"]),
  name: z.string().trim().min(1).max(160),
});

const fillArgumentsSchema = z.strictObject({
  label: z.string().trim().min(1).max(160),
  inputName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/),
});

const finishArgumentsSchema = z.strictObject({
  summary: z.string().trim().min(1).max(500),
});

const humanArgumentsSchema = z.strictObject({
  reasonCode: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/),
});

export type ParsedDiscoveryToolCall =
  | { kind: "action"; decision: DiscoveryActionDecision }
  | { kind: "finish"; callId: string; summary: string }
  | { kind: "human"; callId: string; reasonCode: string };

export function parseDiscoveryToolCall(
  call: ModelToolCall,
): ParsedDiscoveryToolCall {
  if (call.name === "click") {
    const arguments_ = clickArgumentsSchema.parse(call.arguments);
    const target: TargetLocator = {
      strategies: [
        {
          type: "role",
          role: arguments_.role,
          name: arguments_.name,
          exact: true,
        },
      ],
      expectedCardinality: 1,
      rationale: "Exact accessible role and name selected during discovery",
    };
    const action: Action = { type: "click", target };
    return {
      kind: "action",
      decision: { callId: call.callId, action, target },
    };
  }

  if (call.name === "fill") {
    const arguments_ = fillArgumentsSchema.parse(call.arguments);
    const target: TargetLocator = {
      strategies: [{ type: "label", label: arguments_.label, exact: true }],
      expectedCardinality: 1,
      rationale: "Exact accessible label selected during discovery",
    };
    const action: Action = {
      type: "fill",
      target,
      value: { kind: "input", name: arguments_.inputName },
    };
    return {
      kind: "action",
      decision: { callId: call.callId, action, target },
    };
  }

  if (call.name === "finish") {
    const arguments_ = finishArgumentsSchema.parse(call.arguments);
    return { kind: "finish", callId: call.callId, summary: arguments_.summary };
  }

  if (call.name === "request_human") {
    const arguments_ = humanArgumentsSchema.parse(call.arguments);
    return {
      kind: "human",
      callId: call.callId,
      reasonCode: arguments_.reasonCode,
    };
  }

  throw new Error(`Unknown discovery tool ${call.name}`);
}
