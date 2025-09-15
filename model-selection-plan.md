# Model Selection Feature Plan

## Goals
- Allow users to choose between `o3-2025-04-16` and `gpt-5-2025-08-07` from the chat UI (dropdown near text input).
- Thread the selected model through the request pipeline (frontend → backend → OpenAI client).
- Automatically suppress the `reasoning` parameter when the chosen model does not support it (e.g., o3).
- Maintain backward compatibility so existing clients default to GPT-5 when no model is provided.

## Frontend Changes (`frontend/app/page.tsx`)
1. **State Management**
   - Add `const [model, setModel] = useState<'o3-2025-04-16' | 'gpt-5-2025-08-07'>('o3-2025-04-16');` near other hooks.
   - Optional: persist selection in `localStorage` (mirror ThemeProvider pattern) so the choice survives reloads.

2. **UI**
   - Render a `<select>` element adjacent to the textarea (above the send button) with options for the two models and helper text about speed vs depth.
   - Ensure mobile layout keeps the dropdown accessible without crowding the input.

3. **Request Payload**
   - Extend the body in `handleSubmit` (`fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, ...)`) to include `model`.
   - Keep `conversationHistory` unchanged so backend continues to receive prior turns.

4. **Conversation History / UX Enhancements (optional)**
   - Attach the model info to assistant messages if you want to display which engine answered (e.g., store `modelUsed` in message metadata and surface it in the UI tooltip).

## Backend Changes (`src/server.ts`)
1. **Request Validation**
   - Destructure `model` from `req.body` alongside `message`, `conversationHistory`, and `pin`.
   - Validate against an allowlist `const allowedModels = ['o3-2025-04-16', 'gpt-5-2025-08-07'];`.
   - Default to `'gpt-5-2025-08-07'` if the field is missing or invalid.

2. **LLM Invocation**
   - Pass the resolved `model` into `runChatWithTools` instead of the hardcoded string.
   - Consider logging the selected model in the request/response console output for observability.

3. **Response Payload (optional)**
   - Return the `model` in the JSON response if the frontend wants to annotate messages with it later.

## LLM Runner Changes (`src/llm/openai-runner.ts`)
1. **Reasoning Parameter Guard**
   - Introduce `const supportsReasoning = model.startsWith('gpt-5');` (or a small map) inside `runChatWithTools`.
   - When building the initial `client.responses.create` payload and all follow-up payloads, only include `reasoning: { effort: 'high' }` if `supportsReasoning` is true.
   - For o3 requests, omit the `reasoning` field entirely; the rest of the payload stays identical.

2. **Refactor for Reuse**
   - Optionally create a helper `buildRequest(options)` to avoid duplicating conditional spreads across the initial call, tool loop, and finalization pass.

## CLI Entry Point (`src/index.ts`) – Optional
- Add a CLI prompt, environment flag, or command-line argument to choose the model when running the Node REPL version.
- Ensure the selection is passed through to `runChatWithTools` and shares the same reasoning guard.

## Testing Plan
1. **Manual Frontend**
   - Select o3, send a basic question; verify response arrives quickly and backend logs show model=o3 with no reasoning errors.
   - Switch to GPT-5, send an image-enriched prompt; confirm tables, ensure reasoning still applied.
   - Reload page to confirm default model selection behavior (and persistence if implemented).

2. **Backend/Runner**
   - Hit `/api/chat` via `curl` with and without the `model` field to confirm validation and defaulting.
   - Temporarily enable DEBUG in the runner to inspect payloads and ensure `reasoning` is absent for o3.

3. **Regression**
   - Run existing flows (options chains, chart analysis) to ensure no other functionality is impacted.

## Deployment / Config Notes
- No new environment variables are required.
- Update any external documentation (README, guide.md, onboarding materials) to mention the model selector and behavior differences.
- If analytics or logging dashboards track latency, consider tagging requests by model for future insights.
