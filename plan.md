# Migration Plan: Replace Vercel AI SDK with OpenAI Responses API (TypeScript)

## Goals & Constraints
- Replace `ai` + `@ai-sdk/openai` with the official `openai` SDK using the Responses API.
- Preserve all current functionality: PIN auth, chat history, tool use (Polygon + web search), formatting, and API contract to the frontend.
- Keep the existing system prompt text in `src/server.ts` exactly as-is.
- Use model `gpt-5` (current pinned alias in code: `gpt-5-2025-08-07`) with `reasoning.effort = "high"`.
- No raw JSON in user-visible responses; tables and formatting rules remain enforced by the prompt.
- Keep TypeScript-only implementation.

## Current Architecture Summary
- Backend: Express server `src/server.ts` with:
  - `POST /api/auth` PIN gate
  - `POST /api/chat` calling `generateText` from Vercel AI SDK with OpenAI provider, and tools from `src/tools/*`.
  - Builds a long, carefully crafted system prompt with market context; this must remain unchanged.
- CLI: `src/index.ts` also uses `generateText` (developer helper / local REPL).
- Tools:
  - `src/tools/polygon-tools.ts` — Functions to fetch prices, options, aggregates via Polygon.
  - `src/tools/web-tools.ts` — Web search via OpenAI Responses API (preview tool `web_search_preview`).
- Frontend: Next.js app in `frontend/` calls the backend `/api/chat` and renders messages and a list of used tools; no streaming required.

## Target Architecture (OpenAI Responses API)
- Implement a small, reusable tool runner around the OpenAI Responses API that:
  - Accepts chat `messages` (system + history + user), a `tools` registry, a `model`, and options like `maxToolRoundtrips`.
  - Sends messages + tool definitions (as JSON Schema) to `client.responses.create` with `parallel_tool_calls: true` and `reasoning: { effort: 'high' }`.
  - Handles iterative tool calls: when the API asks to `submit_tool_outputs`, execute matching local tools and `submitToolOutputs`, looping until `status = 'completed'` or until a configured max roundtrip is hit.
  - Extracts the final assistant text robustly (`output_text` with fallbacks) and collects a concise list of tool calls for telemetry (name + args), mirroring current response to frontend.

## Step-by-Step Implementation

1) Create OpenAI tool runner module
- Add `src/llm/openai-runner.ts` exporting a function like `runChatWithTools(opts)`:
  - Inputs: `{ model, messages, tools, temperature, maxToolRoundtrips }`.
  - Uses `new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })`.
  - Converts our tool registry into OpenAI tool definitions.
  - Calls `client.responses.create({ model, reasoning: { effort: 'high' }, temperature: 1, messages, tools, parallel_tool_calls: true })`.
  - If `status === 'requires_action'` with `submit_tool_outputs`, execute tools by name and submit outputs with `client.responses.submitToolOutputs({ response_id, tool_outputs })`, loop until `completed` or max reached.
  - Returns `{ text, toolCalls, usage }` where:
    - `text`: concatenated `output_text` or best-effort extraction from `response.output`.
    - `toolCalls`: `[{ toolName, args }]` list executed.
    - `usage`: pass through if provided by SDK (guard for undefined).

2) Map our tools to OpenAI tool schema
- Current registry shape: `{ [name]: { description, parameters: z.ZodSchema, execute(args) } }`.
- Responses API requires JSON Schema for `parameters`.
- Implement a minimal Zod → JSON Schema converter for used shapes (object, string, number, boolean, array, enum) to avoid adding dependencies; place in `src/llm/zod-to-jsonschema.ts`.
- Alternatively (fallback): hand-write JSON Schemas per tool if converter is insufficient; keep parity with Zod.

3) Robust message handling
- Continue building `messages` in `src/server.ts` exactly as today:
  - First message always system with the same prompt (do not modify text), updated each request with current ET time + market status.
  - Append `conversationHistory` from the client.
  - Append the current user message.
- Pass messages 1:1 to `runChatWithTools`.

4) Replace Vercel AI usage in server
- In `src/server.ts`:
  - Remove `import { generateText } from 'ai'` and `import { openai } from '@ai-sdk/openai'`.
  - Import `{ runChatWithTools }` from `src/llm/openai-runner`.
  - Build `tools = { ...polygonTools, ...webTools }` as before.
  - Call `runChatWithTools({ model: 'gpt-5-2025-08-07', messages, tools, temperature: 1, maxToolRoundtrips: 50 })`.
  - Respond with `{ response: text, toolCalls, usage }` identical to current shape to avoid frontend changes.

5) Update CLI entry
- In `src/index.ts`:
  - Replace `generateText` calls with `runChatWithTools`.
  - Keep printing response text, show tool calls summary, and usage if available.

6) Leave web search tool intact
- `src/tools/web-tools.ts` already uses OpenAI Responses for `web_search_preview`. Keep it as-is and include it in `tools` registry.

7) Dependency and config cleanup
- Remove `ai` and `@ai-sdk/openai` imports from code.
- Update `package.json` to remove these dependencies in a follow-up commit; keep `openai`.
- Ensure `.env` usage remains: `OPENAI_API_KEY`, `POLYGON_API_KEY`, `ENTRY_PIN`.

8) Testing plan (manual)
- Backend:
  - `npm run server` and curl `POST /api/chat` with a message requiring tool use, verify tool execution and formatted output.
  - Verify PIN gate still works.
  - Confirm final response has `response` string, `toolCalls` list (names + args), and `usage` when returned by API.
- CLI:
  - `npm run start` and try several prompts (single/multi tool calls, chains, aggregates, options pricing).
- Frontend:
  - Run Next.js, confirm chat works; messages render; tool calls list displays.

9) Rollout plan
- Land backend and CLI changes first; verify locally.
- Remove deprecated deps; run a full `npm i` in CI/host environment.
- Deploy backend; confirm `/health` and `/api/chat` with sample prompts.
- Deploy frontend if necessary (no API shape change expected).

10) Risks & mitigations
- Tool loop semantics: Ensure we iterate until `status === 'completed'` or max trips; guard infinite loops; log tool errors succinctly.
- JSON Schema mismatch: Start with a minimal Zod→JSON Schema converter tailored to current tools; add hand-written fallback for any tricky cases.
- Output extraction: Prefer `response.output_text`; include a safe fallback to walk `response.output` and join `text` fragments.
- Token usage: The Responses API may not always return identical usage metrics; handle undefined gracefully.
- Model quirks: Keep `temperature: 1` and `reasoning.effort: 'high'` for `gpt-5`; make model configurable via env if needed later.

11) Acceptance criteria
- No references to Vercel AI SDK in code or `package.json`.
- `/api/chat` produces equivalent behavior and response shape as before, now powered by OpenAI Responses API with tool use.
- System prompt string in `src/server.ts` is unchanged apart from the dynamic time/market lines.
- Tools execute via the new loop with `parallel_tool_calls: true`; complex multi-call chains work.
- Model is `gpt-5-2025-08-07` (or `gpt-5`) with `reasoning.effort = 'high'`.

## Implementation Sketches

A) Tool runner outline (TypeScript)

```ts
// src/llm/openai-runner.ts
import OpenAI from 'openai';
import { toJsonSchema, toOpenAITools } from './zod-to-jsonschema';

export interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string }
export interface ToolSpec {
  description: string;
  parameters: any; // zod schema
  execute: (args: any) => Promise<any>;
}

export async function runChatWithTools({
  model,
  messages,
  tools,
  temperature = 1,
  maxToolRoundtrips = 50,
}: {
  model: string;
  messages: ChatMessage[];
  tools: Record<string, ToolSpec>;
  temperature?: number;
  maxToolRoundtrips?: number;
}) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const toolDefs = toOpenAITools(tools); // { type:'function', name, description, parameters }
  const executed: Array<{ toolName: string; args: any }> = [];

  let response = await client.responses.create({
    model,
    reasoning: { effort: 'high' },
    temperature,
    messages,
    tools: toolDefs,
    parallel_tool_calls: true,
  });

  let rounds = 0;
  while (
    (response.status === 'requires_action' && response.required_action?.type === 'submit_tool_outputs') &&
    rounds < maxToolRoundtrips
  ) {
    rounds++;
    const toolCalls = response.required_action.submit_tool_outputs.tool_calls || [];
    const outputs = await Promise.all(toolCalls.map(async (tc: any) => {
      const name = tc.name as string;
      const args = safeParseArgs(tc.arguments);
      executed.push({ toolName: name, args });
      const tool = tools[name];
      let output: any;
      try { output = await tool.execute(args); }
      catch (err: any) { output = { error: true, message: err?.message || String(err) }; }
      return { tool_call_id: tc.id, output: JSON.stringify(output) };
    }));

    response = await client.responses.submitToolOutputs({
      response_id: response.id,
      tool_outputs: outputs,
    });
  }

  const text = extractText(response);
  const usage = (response as any).usage ?? undefined;
  return { text, toolCalls: executed, usage };
}

function safeParseArgs(input: any) {
  if (typeof input === 'object') return input;
  try { return JSON.parse(String(input)); } catch { return {}; }
}

function extractText(res: any): string {
  // Prefer output_text if present
  if (res?.output_text && typeof res.output_text === 'string') return res.output_text;
  // Fallback: walk output array and join text parts
  const parts: string[] = [];
  const arr = res?.output || [];
  for (const item of arr) {
    if (item?.type === 'message') {
      for (const c of item?.content || []) {
        if (c?.type === 'output_text' && typeof c?.text === 'string') parts.push(c.text);
        else if (c?.type === 'text' && typeof c?.text === 'string') parts.push(c.text);
      }
    }
    if (item?.type === 'output_text' && typeof item?.text === 'string') parts.push(item.text);
    if (item?.type === 'message' && typeof item?.content === 'string') parts.push(item.content);
  }
  return parts.join('\n').trim();
}
```

B) Zod → JSON Schema (minimal)

```ts
// src/llm/zod-to-jsonschema.ts
import { z } from 'zod';

export function toOpenAITools(tools: Record<string, any>) {
  return Object.entries(tools).map(([name, t]) => ({
    type: 'function',
    name,
    description: t.description,
    parameters: toJsonSchema(t.parameters),
  }));
}

export function toJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return { type: 'object' };
  if (schema instanceof (z as any).ZodObject) {
    const shape = (schema as any)._def.shape();
    const required: string[] = [];
    const properties: Record<string, any> = {};
    for (const [key, sub] of Object.entries(shape)) {
      const isOptional = sub.isOptional?.() || sub?._def?.typeName === 'ZodOptional';
      if (!isOptional) required.push(key);
      properties[key] = toJsonSchema(sub);
    }
    const out: any = { type: 'object', properties };
    if (required.length) out.required = required;
    return out;
  }
  const def = (schema as any)?._def?.typeName;
  switch (def) {
    case 'ZodString': return { type: 'string' };
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodArray': return { type: 'array', items: toJsonSchema(schema._def.type) };
    case 'ZodEnum': return { type: 'string', enum: schema._def.values };
    case 'ZodOptional': return toJsonSchema(schema._def.innerType);
    default: return { type: 'string' }; // safe fallback
  }
}
```

Note: The above sketches guide the implementation. We’ll tailor exact types/exports when coding.

## Files To Add/Update
- Add: `src/llm/openai-runner.ts` (tool loop + text extraction)
- Add: `src/llm/zod-to-jsonschema.ts` (minimal schema converter)
- Update: `src/server.ts` (use new runner; keep system prompt unchanged)
- Update: `src/index.ts` (use new runner)
- Update: `package.json` (remove `ai` and `@ai-sdk/openai` after migration)

## What Will Not Change
- The system prompt content in `src/server.ts`.
- Frontend API contract: request body and response shape of `/api/chat`.
- Tools’ external behavior and names.
- PIN gate and CORS settings.

## Next Actions
- Implement the two LLM modules and swap the server/CLI wiring.
- Verify multi-round tool use and formatting on several real prompts.
- Remove Vercel AI dependencies from `package.json`.
