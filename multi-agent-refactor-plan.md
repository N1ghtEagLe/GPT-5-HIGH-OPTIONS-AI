# Multi-Agent Refactor Plan

This document captures the full set of changes required to refactor the current single-agent trading assistant into a multi-agent architecture. The goal is to improve reliability, enforce format compliance, and allow each agent to focus on a narrower instruction set while a central orchestrator coordinates work.

---

## 1. High-Level Architecture

1. Introduce an `orchestrator` module that:
   - Receives the user request and conversation context.
   - Runs a lightweight router (classification model call) to determine which specialist agents to invoke and in what order.
   - Supplies each agent with trimmed task-specific context and consolidated environment metadata (current timestamp, market status, etc.).
   - Collects agent outputs, performs validation (table/format checks), and stitches them into the final assistant response.

2. Define specialist agents, each with its own system prompt and tool subset:
   - `marketDataAgent`: handles daily OHLC, aggregates, snapshots, and intraday quotes.
   - `optionsAgent`: handles option chains, single-contract prices, Greeks.
   - `fundamentalsAgent`: handles financial statements and fundamentals.
   - `chartAgent`: handles `renderChart` requests only.
   - `researchAgent`: handles web search / contextual news.

3. Maintain a top-level summary agent pass if needed for narrative synthesis (optional). This agent receives structured outputs from specialists and generates natural language commentary while respecting formatting rules.

---

## 2. File & Module Restructuring

### 2.1 Directory Layout Adjustments

- Create `src/agents/` with the following files:
  - `orchestrator.ts`
  - `router.ts` (or `task-router.ts`): encapsulates the routing model call & classification schema.
  - `market-data-agent.ts`
  - `options-agent.ts`
  - `fundamentals-agent.ts`
  - `chart-agent.ts`
  - `research-agent.ts`
  - `summary-agent.ts` (optional; see §6).

- Create `src/prompts/` directory with distinct prompt files:
  - `base-context.ts`: exports shared metadata builder (`buildSharedContext()` returning timestamp, market status, disclaimers).
  - `market-data.prompt.ts`
  - `options.prompt.ts`
  - `fundamentals.prompt.ts`
  - `chart.prompt.ts`
  - `research.prompt.ts`
  - `summary.prompt.ts` (if final narration agent is used).

### 2.2 Prompt Extraction & Rationalization

1. Remove the inlined mega prompt from `src/index.ts` and `src/server.ts`.
2. Populate each prompt file with only the instructions required for that agent:
   - `market-data.prompt.ts` should cover OHLC usage rules, tables, relative date handling, but not option-specific directives.
   - `options.prompt.ts` should include option-chain logic, moneyness rules, Greeks instructions, and table schemas.
   - `fundamentals.prompt.ts` should detail financial table layout (metrics = rows, periods = columns), unit handling, and data completeness rules.
   - `chart.prompt.ts` focuses on chart schema, arrangement rules, axis guidance, and when to fall back if data is missing.
   - `research.prompt.ts` emphasizes allowed sources, summarization requirements, and prohibition on pricing data.
3. Each prompt should import from `base-context.ts` to embed the dynamic portion (date, market status) at runtime.
4. Add explicit “self-check” bullet lists (e.g., “Before finalizing, verify: 1) tables rendered, 2) numeric columns aligned”) to each specialist prompt to reduce format drift.

---

## 3. Tool Partitioning

### 3.1 Polygon Tool Modularization

1. Refactor `src/tools/polygon-tools.ts` to expose grouped tool sets:
   - `polygonMarketTools`: includes `getDailyOpenClose`, `getMultipleDailyOpenClose`, `getAggregates`, `getTickerSnapshot`, etc.
   - `polygonOptionsTools`: includes `getOptionPrice`, `getOptionsChain`, `getOptionsChainByStrikes`, `getOptionsGreeks` (if defined), etc.
   - `polygonFinancialTools`: includes `getFinancials`, and any other fundamentals endpoints.

2. Implementation steps:
   - Extract existing execute functions into standalone named functions (e.g., `async function executeGetDailyOpenClose(...)`).
   - Export grouped constants:
     ```ts
     export const polygonMarketTools = { getDailyOpenClose, getMultipleDailyOpenClose, getAggregates, ... };
     export const polygonOptionsTools = { getOptionPrice, getOptionsChain, ... };
     export const polygonFinancialTools = { getFinancials, ... };
     ```
   - Ensure there is a default export (`polygonTools`) that maintains the union for backwards compatibility until the refactor is complete.

3. Update helper references (e.g., the logging utilities, financial metric normalization) to remain accessible after the split. If certain helpers are cross-cutting, move them to `src/tools/helpers/common.ts` and re-export where needed.

### 3.2 Chart Tool Isolation

- Keep `renderChart` within `src/tools/chart-tool.ts`, but export a `chartTools` object that the chart agent can consume without dragging in Polygon dependencies.
- Add a lightweight validator that ensures the chart agent only pushes valid data arrays (length checks, numeric coercion). The orchestrator will rely on this to detect chart failures.

---

## 4. Orchestrator Responsibilities & Implementation Details

1. **Input Handling**
   - Accept `{ userMessage, conversationHistory, modelOverride? }`.
   - Normalize history: convert to simple `{ role, content }` objects.
   - Compute shared context: `const sharedContext = buildSharedContext();` (current timestamp, market status, disclaimers).

2. **Routing Phase**
   - Call `router.classifyTask({ userMessage, recentMessages, sharedContext })`.
   - The router uses `runChatWithTools` **without external tools** (model call only). Temperature low (e.g., 0.1). It returns a JSON object describing `tasks`, such as:
     ```json
     {
       "tasks": [
         { "kind": "market_data", "arguments": { ... } },
         { "kind": "options_analysis", "arguments": { ... } },
         { "kind": "chart", "dependencies": ["market_data"], ... }
       ],
       "finalNarrative": true
     }
     ```
   - Define a zod schema for the router output to enforce structure. If parsing fails, log and fall back to a default single-agent pass (initial compatibility mode).

3. **Task Execution Phase**
   - For each task (in dependency order), invoke the corresponding agent runner with:
     - System prompt derived from the agent’s prompt file + `sharedContext`.
     - Trimmed conversation snippet relevant to the task (e.g., the last user prompt plus any agent outputs that feed into dependencies).
     - The correct tool bundle.
   - Capture the raw output text and any tool call metadata for logging.

4. **Validation Phase**
   - Run static checks on agent outputs:
     - Confirm required markdown tables exist when tasks include Polygon data.
     - Ensure numeric columns have at least one digit; guard against empty tables.
     - If validation fails, re-run the agent with a “format repair” message (short instruction appended to the prompt) **once**.
   - For chart tasks, verify the agent called `renderChart`; if not, issue a format repair request or return a user-facing note that chart generation failed.

5. **Aggregation Phase**
   - If a final narrative pass is configured, assemble structured snippets for the `summary-agent` (e.g., JSON objects with table references, highlighted metrics, chart IDs).
   - Otherwise, assemble the final response by concatenating the validated tables and a cohesive narrative produced by the orchestrator itself.

6. **Output**
   - Return:
     ```ts
     {
       text: finalMarkdown,
       toolCalls: aggregatedToolCallMetadata,
       usage: combinedTokenUsage
     }
     ```
   - Update `messages` history (`src/index.ts`) to record per-task outputs if you keep a transcript.

---

## 5. Agent Runner Templates

Create a reusable helper in `src/agents/agent-runner.ts`:
```ts
export async function runAgent({
  model,
  systemPrompt,
  messages,
  tools,
  temperature,
  maxToolRoundtrips,
}: AgentRunParams) {
  return runChatWithTools({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools,
    temperature,
    maxToolRoundtrips,
  });
}
```
Each specialist agent wraps this helper:
- `market-data-agent.ts`
  ```ts
  import { marketDataPrompt } from '../prompts/market-data.prompt';
  import { polygonMarketTools } from '../tools/polygon-tools';
  export async function runMarketDataAgent(params) {
    return runAgent({
      ...params,
      systemPrompt: marketDataPrompt(params.sharedContext),
      tools: polygonMarketTools,
      temperature: 0.2,
      maxToolRoundtrips: 8,
    });
  }
  ```
- Repeat analogous structure for options, fundamentals, chart, research (with their tool subsets and temperature values).

---

## 6. Final Narrative Agent (Optional but Recommended)

- Purpose: unify tables from multiple specialists, add prose, and ensure the response begins with the proper table (per spec).
- Implementation:
  - Input: structured payload from orchestrator (e.g., an array of `{ taskId, summary, primaryTable, errors? }`).
  - Prompt instructs the summary agent to assemble the final markdown, referencing the existing tables, acknowledging charts, and incorporating any research summaries.
  - Tools: none (final text-only pass).
  - Temperature: moderate (0.4–0.5) for fluent output.
  - If this agent fails formatting checks, orchestrator remediates or falls back to deterministic stitching.

---

## 7. API Surface Changes

### 7.1 CLI (`src/index.ts`)
- Replace direct `runChatWithTools` invocation with:
  ```ts
  import { orchestrateTurn } from './agents/orchestrator';
  const result = await orchestrateTurn({
    userMessage: input,
    conversationHistory: messages,
    model: 'gpt-5-2025-08-07',
  });
  ```
- Update `messages.push` to store:
  - The user message.
  - A single assistant message containing `result.text` (same as today) to keep transcript compatibility.
- Display aggregated tool calls (`result.toolCalls`) in the debug output loop as currently done.

### 7.2 HTTP Server (`src/server.ts`)
- Apply the same orchestrator integration inside the `/api/chat` handler.
- Ensure request payload includes `conversationHistory`; orchestrator will manage per-agent context internally.
- Add logging around router decisions to aid debugging (e.g., `[Router] tasks=[market_data, chart]`).

---

## 8. Validation & Testing Strategy

1. **Unit-Level**
   - Add tests for `router` classification using canned prompts (`Jest` or `vitest`). Ensure expected tasks are emitted.
   - Test prompt builders (`marketDataPrompt`, etc.) to verify key instructions are present (regex assertions on the strings).
   - Write schema tests for the refactored tool groups (ensure each agent only sees intended functions).

2. **Integration**
   - Spin up mocked tool executors (simulate Polygon responses) to run orchestrator end-to-end without external calls.
   - Verify that multi-task prompts produce a single combined assistant response starting with a table.
   - Ensure chart requests trigger the chart agent and mention the chart in the final message.

3. **Manual Regression**
   - Run existing CLI scenarios (daily OHLC, option chain, fundamentals, chart generation) and confirm formatting compliance.
   - Test failure cases: router misclassification fallback, tool failure propagation, format repair triggers.

4. **Logging/Telemetry Enhancements**
   - In orchestrator, log per-agent token usage and tool calls for future monitoring.
   - Optionally, add metrics counters (e.g., how often format repair was needed) for reliability tracking.

---

## 9. Rollout Plan

1. Implement tool modularization and prompt extraction first while keeping the single-agent flow (feature flagged):
   - Create the new prompt files and update `runChatWithTools` calls to use `marketDataPrompt` for all requests temporarily.
   - Ensure no regressions before proceeding.
2. Introduce the orchestrator and specialist agents behind a config flag (`USE_MULTI_AGENT=true`).
3. Test orchestrator flow end-to-end in local CLI and server sandbox.
4. Flip the default to multi-agent once reliability is confirmed; keep the old single-agent path accessible for emergency fallback during rollout.

---

## 10. Open Questions & Decisions

- Do we need memory across turns for each agent, or is summarizing per task sufficient? (Recommendation: summarizing per task keeps prompts lighter.)
- Should the router always call all relevant agents or allow the user to force a specific path via commands? (Option: support slash commands like `/chart` to bypass routing.)
- How will we persist/chart identifiers to front-end clients after multi-agent refactor? Ensure orchestrator surface includes chart metadata (IDs, titles) for the UI.

---

## 11. Estimated Work Breakdown

1. Tool grouping + prompt extraction: ~1 day.
2. Agent runner templates + orchestrator scaffolding: ~1.5 days.
3. Router schema + classification prompt: ~0.5 day.
4. Validation logic + format repair workflow: ~0.5 day.
5. HTTP/CLI integration + config toggles: ~0.5 day.
6. Tests & manual QA: ~1 day.

_Total: ~5 days of focused work (single engineer) including testing._

---

This plan prioritizes strict separation of concerns, lightweight routing, and format enforcement checks to address the reliability issues observed in the current monolithic agent design.

## 12. Conversation History Strategy

- Maintain the canonical transcript (user + final assistant messages) in the orchestrator layer only. Specialist agents never receive the whole history by default.
- Before each turn, derive a compact `recentContext` object that captures just the essentials needed for routing (e.g., last user request, short summary of previous assistant reply, outstanding follow-ups).
- When the router runs, supply only the `recentContext` so it can decide which tasks to trigger without incurring unnecessary token load.
- For each specialist call, assemble a task-specific message bundle:
  - Current user instruction.
  - Any structured outputs from prerequisite tasks (spot price, arrays of closes, financial metrics, etc.).
  - Optional micro-summaries of relevant prior turns (1–2 sentences) when continuity matters (“Earlier you provided NVDA daily closes; now the user wants Greeks.”).
- Store raw agent outputs and a normalized summary payload (e.g., JSON with key figures) in orchestrator memory. On later turns, reuse these summaries instead of replaying the full text.
- If the user explicitly references older conversation details, fetch the relevant stored summary or the original agent output, collapse it into a snippet (<400 tokens), and include it in the next agent call.
- The orchestrator appends only the final stitched assistant reply to the persistent history, keeping the external conversation unchanged from the client’s perspective.

## 13. Router vs. Orchestrator Responsibilities

| Component   | Role | Inputs | Outputs | Implementation Notes |
|-------------|------|--------|---------|----------------------|
| Router (`router.ts`) | Classifies the user request into discrete tasks and dependency order | Current user message, compact prior-context summary, shared context metadata | JSON payload defining `tasks`, dependencies, optional flags like `needsSummary` | Can be deterministic logic or a tiny structured LLM call (no tools). No tool execution or user-facing text. |
| Orchestrator (`orchestrator.ts`) | End-to-end coordinator for the turn | User message, full conversation history, router decisions, shared context | Final assistant reply text, aggregated tool call metadata, token usage | Pure TypeScript control flow. Calls the router, packages per-agent inputs, invokes specialist agents, performs validation, handles retries/fallbacks, and stitches the final response. |

- The router is a narrow helper the orchestrator *uses*. If router output is missing or invalid, the orchestrator falls back to a safe default (e.g., run market + options agents when tickers and options keywords appear).
- The orchestrator owns error handling: if an agent fails, it can retry with amended instructions, omit that task with a user-facing warning, or revert to the legacy single-agent pipeline.
- Because the orchestrator is deterministic, it is easy to unit test routing decisions, retry behavior, and validation without involving any LLM calls.

## 14. Example Turn Walkthrough (Data & Logic Flow)

Example user request: “Plot the last month’s daily closes for NVDA and summarize any notable options activity.”

1. **Input Receipt**
   - CLI/HTTP layer calls `orchestrateTurn({ userMessage, conversationHistory })`.
   - Shared context builder returns: `Thursday, April 24 2025 2:15 PM ET; marketStatus = Open`.

2. **Routing**
   - Router receives: user message + short recap (“Previous reply: Compared NVDA and AMD fundamentals”).
   - Router returns JSON:
     ```json
     {
       "tasks": [
         { "id": "market", "kind": "market_data", "args": { "ticker": "NVDA", "range": "1M" } },
         { "id": "options", "kind": "options_analysis", "dependsOn": ["market"], "args": { "ticker": "NVDA", "focus": "notable activity" } },
         { "id": "chart", "kind": "chart", "dependsOn": ["market"], "args": { "series": "daily_close" } }
       ],
       "needsSummary": true
     }
     ```

3. **Task Execution**
   - **Market task**
     - Messages: system prompt from `market-data.prompt.ts` + user message narrowed to “Retrieve NVDA daily OHLC for the past month.”
     - Tools: `polygonMarketTools` only.
     - `runChatWithTools` triggers `getAggregates` and returns a markdown table.
     - Orchestrator validates (table present, headers correct), stores raw text + structured summary (dates, closes array).
   - **Options task** (depends on `market`)
     - Messages: system prompt from `options.prompt.ts`, user instruction referencing market summary (“Use spot $865.32 from latest close”).
     - Tools: `polygonOptionsTools`.
     - Agent calls `getOptionsChain`; orchestrator confirms the response begins with an options table. If not, it appends a “Format reminder” and reruns once.
     - Store output and a JSON digest (notable strikes, volumes, IVs).
   - **Chart task** (depends on `market`)
     - Messages: chart prompt + user request “Render line chart for NVDA daily close; here is the data: …” where the data is the structured array from the market agent.
     - Tools: `chartTools` (renderChart only).
     - Validate that the agent invoked `renderChart` and mentioned the chart; capture chart metadata for the front end.

4. **Summary / Final Assembly**
   - Because `needsSummary` is true, orchestrator feeds a structured payload to `summaryAgent` (or uses deterministic stitching) describing:
     - Market highlights (1M high/low, last close).
     - Options highlights (top OI strikes, notable volume spikes).
     - Chart reference (chart ID, title).
   - Summary agent returns a final markdown block, starting with the market data table, then commentary referencing the options table and the chart.
   - Orchestrator re-validates formatting. On failure, it can retry once with an appended instruction or default to combining the stored tables plus bullet commentary programmatically.

5. **Output Delivery**
   - Orchestrator returns `{ text, toolCalls, usage }`.
   - CLI/server prints the text, logs aggregated tool calls, and appends the final message to `conversationHistory`.

This end-to-end flow keeps each agent prompt small, ensures only relevant tools are exposed, allows deterministic validation/repair, and produces a single user-facing response that still honors the existing conversation contract.
