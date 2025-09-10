# Tool Learnings: OpenAI Responses API (Function Tools) in This Project

This doc captures everything we learned while migrating from the Vercel AI SDK to the OpenAI Responses API for tool use. It explains the correct request/response shapes, common pitfalls, and how our code is structured to make tool-calling reliable.

## Big Picture
- We now use the OpenAI Responses API (not Assistants, not Chat Completions) with custom function tools.
- The model’s system prompt is sent as `instructions`. Conversation turns are sent in `input` as message items.
- When the model wants a tool, Responses returns inline `function_call` items and status `completed`. We must execute tools locally and call `responses.create` again with `previous_response_id` + `function_call_output` items.
- We run this loop until no more `function_call` items remain, then extract the final text and return it.

## Key Differences vs. Assistants API
- Assistants API: returns `status = requires_action` and expects `runs.submitToolOutputs`.
- Responses API: returns `function_call` items in the `output` array under `status = completed` and expects another `responses.create` with `function_call_output` items and `previous_response_id`.

We use the Responses API loop exclusively.

## Message Shapes (Critical)
- System prompt → `instructions: string` (we extract from the first `system` message in server.ts).
- Conversation turns → `input: Array<Message>` where each item uses `role` and `content` with typed parts:
  - For user: `{ type: 'input_text', text: '...' }`
  - For assistant: `{ type: 'output_text', text: '...' }` or `{ type: 'refusal', ... }`

Example (simplified):
```ts
const instructions = systemPrompt; // exact string from server.ts
const input = [
  { role: 'user', content: [{ type: 'input_text', text: 'Price for GOOGL yesterday?' }] },
  { role: 'assistant', content: [{ type: 'output_text', text: 'Sure, fetching…' }] },
  { role: 'user', content: [{ type: 'input_text', text: 'Also show an options quote.' }] },
];
```

If you accidentally send assistant messages with `input_text`, you’ll get 400 errors like:
- "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'."

## Tool Definitions (Critical)
- Responses API requires flat function tool objects (not nested under `function`).
- We also set `strict: true` to reduce argument drift and ensure schemas are respected.
- JSON Schema must include:
  - `type: 'object'`
  - `properties`
  - `required`: must list every key in `properties` when `strict: true`
  - `additionalProperties: false`

Example tool object we generate:
```ts
const tools = [{
  type: 'function',
  name: 'getDailyOpenClose',
  description: 'Get daily OHLC for a ticker on a date',
  parameters: {
    type: 'object',
    properties: {
      ticker: { type: 'string', description: 'Stock ticker' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
      adjusted: { type: 'boolean', description: 'Adjusted prices' },
    },
    required: ['ticker', 'date', 'adjusted'],         // include every property when strict: true
    additionalProperties: false,
  },
  strict: true,
}];
```

Common schema errors we hit and fixes:
- "Missing required parameter: 'tools[0].name'" → wrong tool shape (must be flat, not nested under `function`).
- "Invalid_function_parameters: Missing 'adjusted'" → with `strict: true`, the `required` array must list every key present in `properties` (even if optional in Zod). We updated the Zod→JSON Schema converter to do this.

## Zod → JSON Schema Mapping (What We Generate)
- Every ZodObject becomes `{ type: 'object', properties, required: ALL_KEYS, additionalProperties: false }`.
- We carry over `description` where present.
- Arrays, enums, numbers, booleans map naturally.

Snippet from `src/llm/zod-to-jsonschema.ts`:
```ts
export function toOpenAITools(tools: Record<string, any>) {
  return Object.entries(tools).map(([name, t]) => ({
    type: 'function',
    name,
    description: t.description || '',
    parameters: toJsonSchema(t.parameters),
    strict: true,
  }));
}

export function toJsonSchema(schema: any): any {
  // ZodObject → { type:'object', properties, required: ALL_KEYS, additionalProperties:false }
}
```

## The Tool Loop (Responses API)
- Step 1: First call with `instructions`, `input`, `tools`.
- Step 2: Inspect `response.output` for `function_call` items.
- Step 3: For each call → execute local tool → capture JSON-serializable output string.
- Step 4: Second call with `previous_response_id` and `input` as array of `function_call_output` items:
  - `{ type: 'function_call_output', call_id: '<same id>', output: '<stringified result>' }`
- Step 5: Repeat Step 2–4 until no more `function_call` items.
- Step 6: Extract `response.output_text` or join text parts in `response.output`.

Minimal TypeScript outline (simplified from our runner):
```ts
const first = await client.responses.create({
  model: 'gpt-5',
  instructions,
  input,      // message parts as above
  tools,      // flat function tools, strict: true
  parallel_tool_calls: true,
  reasoning: { effort: 'high' },
});

let res = first;
for (let i = 0; i < maxToolRoundtrips; i++) {
  const calls = (res.output || []).filter((x: any) => x.type === 'function_call');
  if (calls.length === 0) break;

  const outputs = await Promise.all(calls.map(async (c: any) => {
    const name = c.name;                     // tool name
    const args = JSON.parse(c.arguments);    // tool args as object
    const out = await tools[name].execute(args);
    const outputStr = typeof out === 'string' ? out : JSON.stringify(out);
    return { call_id: c.call_id, output: outputStr };
  }));

  res = await client.responses.create({
    model: 'gpt-5',
    previous_response_id: res.id,
    input: outputs.map(o => ({
      type: 'function_call_output',
      call_id: o.call_id,
      output: o.output
    })),
    tools,
    reasoning: { effort: 'high' },
    parallel_tool_calls: true,
  });
}

const text = res.output_text || extractText(res.output);
```

## Input Gotchas We Hit
- Using `messages` instead of `input` → 400: "Unsupported parameter: 'messages'". Use `instructions` + `input`.
- Sending assistant messages as `input_text` → 400: only `output_text` or `refusal` allowed for assistant content.
- Using `tool_choice: 'auto'` → 400 (SDK version expected only `'file_search'`). We omit `tool_choice` entirely.

## Execution & Serialization
- For each `function_call`, we:
  - Parse args safely (try JSON.parse; fallback to empty object).
  - Call the matching local tool: `tools[name].execute(args)`.
  - Serialize results as strings: `JSON.stringify(result)` when not already a string.
- We return one `function_call_output` per `call_id`.
- We cap the loop with `maxToolRoundtrips` to avoid runaway.

## System Prompt Handling (Preserved)
- The carefully crafted system prompt in `server.ts` is the first system message.
- The runner extracts it and passes it verbatim as `instructions` for each turn.
- For tool follow-ups in the same turn, we rely on `previous_response_id` and do not resend `instructions`.

## Logging That Helped
- Print initial create summary: model, message count, tool count, instructions length.
- Print `function_calls` count each round, then each tool name + truncated args and truncated result.
- Print follow-up status and final text length.

This made it easy to spot whether we got `function_call` vs. text, whether execute ran, and whether final text was empty.

## Typical Errors & Fixes (Cheat Sheet)
- 400 Missing tools[0].name → Use flat tool objects `{ type:'function', name, ... }`.
- 400 Unsupported parameter 'messages' → Use `instructions` + `input` (no `messages`).
- 400 Invalid value 'input_text' for assistant → Map assistant content to `{ type:'output_text' }`.
- 400 invalid_function_parameters (missing required) → With `strict: true`, `required` must list every property key; add `additionalProperties:false`.
- Completed with `function_call` but no text → You must execute tools and call `responses.create` again with `previous_response_id` + `function_call_output`.
- `submitToolOutputs` not found → That’s for Assistants; use `responses.create` with `function_call_output`.

## Practical Example From This Project
- Tool: `getOptionPrice(underlyingTicker, strike, expirationDate, optionType)` (Polygon snapshot APIs).
- The model issues one or more `function_call` items with arguments for this schema.
- We run the tool(s), send `function_call_output` items, and the model then writes structured tables (as instructed by the system prompt), not raw JSON.

## Best Practices We Adopted
- Set `strict: true` and disallow additionalProperties to keep arguments clean.
- Use `parallel_tool_calls: true` and batch function outputs per round.
- Keep server stateless across turns; use `previous_response_id` within a single turn only.
- Guard with `maxToolRoundtrips`.
- Always `JSON.stringify` tool outputs (unless already string).
- Always extract text via `output_text` with a safe fallback to walk `output` items.

## Future Enhancements (Optional)
- Add `tool_choice: 'required'` on first calls if we want to force tool use for certain prompts.
- Switch to the “stateless full-control” orchestration pattern (append prior output items + your outputs to a full context object) if we need maximum control over state.
- Add richer error shaping from tools for consistent downstream formatting.

That’s the playbook we used to get tool use working reliably with the Responses API in this codebase.
