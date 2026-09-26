import OpenAI from "openai";
import type {
  ResponseInputItem,
  Tool,
} from "openai/resources/responses/responses";

import type {
  DiscoveryModel,
  ModelToolCall,
  ModelTurn,
  ModelTurnResult,
} from "./types.js";

const tools: Tool[] = [
  {
    type: "function",
    name: "click",
    description:
      "Click one visible control by its exact accessible role and name.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["button", "link"] },
        name: { type: "string" },
      },
      required: ["role", "name"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "fill",
    description:
      "Fill one visible form control using a declared input. Never provide a literal value.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        label: { type: "string" },
        inputName: { type: "string" },
      },
      required: ["label", "inputName"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "finish",
    description:
      "Declare the goal complete only after the UI visibly confirms the requested change.",
    strict: true,
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "request_human",
    description:
      "Stop and request a human when sensitive data, ambiguity, or an unsafe action is encountered.",
    strict: true,
    parameters: {
      type: "object",
      properties: { reasonCode: { type: "string" } },
      required: ["reasonCode"],
      additionalProperties: false,
    },
  },
];

export interface OpenAIDiscoveryModelOptions {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
}

export class OpenAIDiscoveryModel implements DiscoveryModel {
  readonly #client: OpenAI;
  readonly #model: string;
  readonly #conversation: ResponseInputItem[] = [];
  #started = false;

  constructor(options: OpenAIDiscoveryModelOptions = {}) {
    this.#client = options.client ?? new OpenAI({ apiKey: options.apiKey });
    this.#model = options.model ?? "gpt-6-luna";
  }

  async nextTurn(turn: ModelTurn): Promise<ModelTurnResult> {
    if (!this.#started) {
      this.#conversation.push({
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildInitialPrompt(turn),
          },
        ],
      });
      this.#started = true;
    } else {
      const previous = turn.previousToolResult;
      if (previous === undefined) {
        throw new Error("A continued model turn requires a tool result");
      }
      this.#conversation.push({
        type: "function_call_output",
        call_id: previous.callId,
        output: JSON.stringify(previous.output),
      });
    }

    const response = await this.#client.responses.create({
      model: this.#model,
      instructions:
        "You operate a synthetic contacts web app through bounded semantic tools. Choose exactly one tool per turn. Use only exact names visible in the observation. Use declared input names for fill actions. Do not guess, use sensitive data, or declare success without visible confirmation.",
      input: this.#conversation,
      tools,
      tool_choice: "required",
      parallel_tool_calls: false,
      store: false,
    });

    this.#conversation.push(
      ...(response.output as unknown as ResponseInputItem[]),
    );
    const toolCalls: ModelToolCall[] = response.output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        callId: item.call_id,
        name: item.name,
        arguments: parseArguments(item.arguments),
      }));

    return {
      responseId: response.id,
      toolCalls,
      outputText: response.output_text,
    };
  }
}

function buildInitialPrompt(turn: ModelTurn): string {
  const inputs = Object.fromEntries(
    Object.entries(turn.inputs).map(([name, input]) => [
      name,
      {
        value: input.value,
        dataClass: input.dataClass,
        description: input.description,
      },
    ]),
  );
  return JSON.stringify({
    goal: turn.goal,
    declaredInputs: inputs,
    currentPage: turn.observation,
  });
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("The model returned invalid JSON tool arguments");
  }
}
