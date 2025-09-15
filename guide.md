Below is a from‑the‑docs, deeply practical guide to getting tool use working with GPT‑5 via the Responses API—including exact request shapes, an async Python loop that closes the function‑calling round‑trip, a free‑form (plaintext) “custom tool” example unique to GPT‑5, and a checklist of the most common failure modes and fixes.

What’s new about GPT‑5 vs earlier models?
GPT‑5 adds verbosity control, minimal reasoning mode, and a new custom tool type that lets the model call tools with plaintext instead of JSON (and optionally constrain that plaintext with a context‑free grammar). It also improves long, multi‑step, chained—and even parallel—tool use. 
OpenAI

0) Quick mental model (how tool use actually works)

You declare tools in your request.

The model may reply with one or more tool calls (instead of user‑visible text).

You run those tools and return their outputs to the model in a follow‑up responses.create call using a small, typed message—and you must thread the turn with previous_response_id.

You repeat until the model returns a normal assistant message.
This exact loop—and the “echo back the previous output” detail—is illustrated in OpenAI’s cookbooks and is critical for correctness. 
OpenAI Cookbook
+1

1) Models & capabilities you’ll use

Model IDs: gpt-5, gpt-5-mini, gpt-5-nano. (There’s also gpt-5-chat-latest for ChatGPT’s non‑reasoning sibling.) 
OpenAI

New parameters (GPT‑5 only):

text.verbosity: "low" | "medium" | "high" to bias answer length/detail.

reasoning.effort: includes "minimal" (new) for fastest time‑to‑first‑token when you don’t want deep reasoning.

custom tools: let the model send raw text payloads (e.g., code, SQL) instead of JSON; can be constrained by grammar (Lark or regex). 
OpenAI
OpenAI Cookbook

Statefulness: The Responses API is stateful and supports previous_response_id to carry conversation state without you manually restitching every turn. 
OpenAI Cookbook

Parallel tool calls: enable with parallel_tool_calls: true on models that support it; GPT‑5 handles long chains and parallelization better than predecessors. 
OpenAI Cookbook
OpenAI Platform

2) Standard JSON function tools (canonical pattern)
2.1 Define tools

Shape (Responses API): each tool entry has "type": "function" plus top‑level "name", "description", and a JSON‑Schema "parameters". (Note: for Responses API tools, the schema and name are not nested under a "function" object.) 
OpenAI Cookbook

[
  {
    "type": "function",
    "name": "get_weather",
    "description": "Get current temperature (°C) by coordinates.",
    "parameters": {
      "type": "object",
      "properties": {
        "latitude":  { "type": "number" },
        "longitude": { "type": "number" }
      },
      "required": ["latitude", "longitude"],
      "additionalProperties": false
    },
    "strict": true
  }
]


Why strict: true? It enforces strict adherence to your JSON Schema and reduces argument drift. 
OpenAI Cookbook

2.2 Async Python: end‑to‑end tool loop (production‑ready pattern)

Uses the official SDK’s AsyncOpenAI client and closes the loop by feeding back both the model’s prior response.output (to preserve reasoning items) and your tool outputs via the typed function_call_output message. 
OpenAI Cookbook
+1

# pip install --upgrade openai httpx
import asyncio, json, os
import httpx
from openai import AsyncOpenAI

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

# --- 1) Your real tool implementations (async) ---
async def get_weather(latitude: float, longitude: float) -> dict:
    """Fetch current temperature (C) using open-meteo.com."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m"
    }
    timeout = httpx.Timeout(15.0)
    async with httpx.AsyncClient(timeout=timeout) as s:
        r = await s.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    # Return JSON-serializable output (string or JSON is fine)
    return {"temperature_c": data["current"]["temperature_2m"]}

TOOL_REGISTRY = {
    "get_weather": get_weather,
}

TOOLS = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "Get current temperature (°C) by coordinates.",
        "parameters": {
            "type": "object",
            "properties": {
                "latitude":  {"type": "number"},
                "longitude": {"type": "number"}
            },
            "required": ["latitude", "longitude"],
            "additionalProperties": False
        },
        "strict": True
    }
]

# --- 2) The agent loop ---
async def run_agent(user_text: str) -> str:
    client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    # First turn
    response = await client.responses.create(
        model="gpt-5",
        input=[{"role": "user", "content": user_text}],
        tools=TOOLS,
        parallel_tool_calls=True,
        # GPT‑5 niceties:
        text={"verbosity": "medium"},
        reasoning={"effort": "low"},
        store=True,
    )

    # Keep turning until you get a final assistant message
    while True:
        # Extract tool calls (could be several if parallel_tool_calls=True)
        tool_calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]

        if not tool_calls:
            # No tool calls => final content is in response.output_text
            return response.output_text

        # 2a) Execute all tool calls concurrently
        tasks, call_ids = [], []
        for call in tool_calls:
            func = TOOL_REGISTRY.get(call.name)
            if not func:
                raise RuntimeError(f"Unknown tool: {call.name}")
            args = json.loads(call.arguments or "{}")
            tasks.append(asyncio.create_task(func(**args)))
            call_ids.append(call.call_id)

        tool_results = await asyncio.gather(*tasks)

        # 2b) Feed back the *previous* response (to preserve reasoning items)
        #     AND the tool outputs as typed items.
        followup_input = []
        followup_input.extend(response.output)  # include reasoning + function_call items

        for call_id, result in zip(call_ids, tool_results):
            # Output can be a string; JSON is also allowed. Serialize non-strings.
            output_str = result if isinstance(result, str) else json.dumps(result)
            followup_input.append({
                "type": "function_call_output",
                "call_id": call_id,
                "output": output_str
            })

        # 2c) Continue the turn with previous_response_id
        response = await client.responses.create(
            model="gpt-5",
            input=followup_input,
            tools=TOOLS,  # keep passing tools for clarity
            previous_response_id=response.id,
            parallel_tool_calls=True,
            text={"verbosity": "medium"},
            reasoning={"effort": "low"},
            store=True,
        )

# Example:
# asyncio.run(run_agent("What's the current temperature in Paris? Use tools and explain."))


Why this works:

The model emits a typed function_call item with call_id, name, and arguments.

You run the tool, then send back a function_call_output that references the same call_id; you also include the model’s prior response.output so it can keep its in‑flight reasoning. This exact pattern comes straight from OpenAI’s tool‑calling cookbooks for the Responses API. 
OpenAI Cookbook
+1

3) GPT‑5’s custom tools (free‑form plaintext calls) + optional grammar

Unlike JSON function tools, GPT‑5 can call tools with plaintext payloads—for example a blob of Python/SQL/shell—using "type": "custom". This is ideal when a tool expects free‑form text, and it’s new for GPT‑5. You can also constrain that plaintext with a grammar (Lark or regex) to guarantee well‑formed strings. 
OpenAI
OpenAI Cookbook

3.1 Plaintext custom tool (quick start)

The model will produce raw code/text in the tool call’s input field:

from openai import OpenAI
client = OpenAI()

resp = client.responses.create(
    model="gpt-5-mini",
    input="Run code_exec to print 1..5 on separate lines.",
    text={"format": {"type": "text"}},
    tools=[{"type": "custom", "name": "code_exec", "description": "Executes Python code"}]
)

# resp.output[1] is typically the tool call
tc = next(x for x in resp.output if getattr(x, "type", "") == "custom_tool_call")
tool_name, code_str, call_id = tc.name, tc.input, tc.call_id
# ...run code in your sandbox...
tool_output = "1\n2\n3\n4\n5"

# Send tool result back:
resp2 = client.responses.create(
    model="gpt-5-mini",
    input=[*resp.output, {"type": "function_call_output", "call_id": call_id, "output": tool_output}],
    previous_response_id=resp.id,
    tools=[{"type": "custom", "name": "code_exec", "description": "Executes Python code"}],
)


Shape highlights: {"type":"custom","name":"...", "description": "..."} and the tool call arrives as a custom_tool_call with an input string. 
OpenAI Cookbook

3.2 Constraining plaintext with a grammar (CFG)

To force the tool input to match a grammar, add a format block inside the tool definition:

sql_tool = {
  "type": "custom",
  "name": "postgres_query",
  "description": "Executes a *read-only* SELECT with LIMIT and basic WHERE/ORDER BY.",
  "format": {
    "type": "grammar",
    "syntax": "lark",  # or "regex"
    "definition": "... your grammar here ..."
  }
}


OpenAI supports Lark and regex grammars; the cookbook shows full examples for dialect‑specific SQL grammars and how to wire calls/outputs. 
OpenAI Cookbook

4) Built‑in tools and MCP (optional, but useful)

The Responses API includes built‑in tools (web search, file search, code interpreter, image generation) and now supports MCP (Model Context Protocol) servers so you can expose remote tool catalogs. Use allowed_tools to restrict surface area and reduce token bloat. 
OpenAI
OpenAI Cookbook

5) Minimal cURL example (two calls)

Call #1 – declare tool(s), let the model decide:

curl https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "input": [{"role":"user","content":"What is the temp in Paris? Use tools."}],
    "tools": [{
      "type":"function",
      "name":"get_weather",
      "description":"Get current temp (°C) by coordinates.",
      "parameters":{"type":"object",
        "properties":{"latitude":{"type":"number"},"longitude":{"type":"number"}},
        "required":["latitude","longitude"],"additionalProperties":false
      },
      "strict":true
    }],
    "parallel_tool_calls": true
  }'


Inspect response: you’ll see an item with "type": "function_call" containing name, arguments (JSON), and a call_id. Run your tool locally.

Call #2 – return tool outputs and continue the same turn (note previous_response_id and the typed function_call_output):

curl https://api.openai.com/v1/responses \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "previous_response_id": "resp_...from_call_1...",
    "input": [
      /* echo back the *entire* output array from call #1 here (reasoning + function_call) */,
      {"type":"function_call_output","call_id":"call_...","output":"{\"temperature_c\":17.8}"}
    ],
    "tools": [{
      "type":"function",
      "name":"get_weather",
      "description":"Get current temp (°C) by coordinates.",
      "parameters":{"type":"object",
        "properties":{"latitude":{"type":"number"},"longitude":{"type":"number"}},
        "required":["latitude","longitude"],"additionalProperties":false
      },
      "strict":true
    }]
  }'


This mirrors the cookbook pattern for Responses API tool loops. 
OpenAI Cookbook

6) Streaming (SSE) notes (optional)

If you need progressive output, set "stream": true and handle Server‑Sent Events; the Responses API emits token/segment deltas such as response.output_text.delta and a terminal response.completed. Use streaming when you want to surface partial UI updates or to intercept function‑call deltas early. 
OpenAI Platform

7) Why tool use often “doesn’t work” (and how to fix it)

You didn’t send tool outputs back with function_call_output.
Fix: For every tool call, send a follow‑up responses.create with {"type":"function_call_output","call_id":"...", "output":"..."} and include previous_response_id. 
OpenAI Cookbook

You forgot to echo the prior response.output.
Fix: Either pass previous_response_id and the tool outputs, or explicitly add all items from the prior response.output to the next input. This preserves hidden reasoning and keeps the turn coherent. 
OpenAI Cookbook

Mismatched call_id.
Fix: Return the exact call_id from the model’s tool call. (If parallel, map them carefully.) 
OpenAI Cookbook

Invalid JSON Schema or missing required fields.
Fix: Keep schemas minimal; set additionalProperties:false; use strict:true. 
OpenAI Cookbook

No tool was chosen.
Fix: Bias usage with tool_choice: "required" (forces at least one tool), or target a specific one with tool_choice: {"type":"function","name":"..."}; default is "auto". 
OpenAI Cookbook

Parallel confusion.
Fix: If you enable parallel_tool_calls:true, execute tool calls concurrently (e.g., asyncio.gather) and return outputs for each call_id. Some reasoning flows still require serial chaining. 
OpenAI Cookbook
OpenAI Platform

Migrating old Chat Completions habits.
Fix: In Responses API, you send typed items (e.g., function_call_output), not role:"tool" messages. Don’t use the old messages shape; use input and previous_response_id. 
OpenAI Cookbook

Using JSON tools where plaintext is natural.
Fix: With GPT‑5, prefer a custom tool when the payload is naturally script/SQL/shell; optionally constrain with a grammar. 
OpenAI Cookbook

Huge MCP tool catalogs balloon tokens.
Fix: Limit with allowed_tools and filter remote servers’ list to control latency and cost. 
OpenAI Cookbook

Over‑reasoning = latency.
Fix: Try reasoning: { "effort": "minimal" } for deterministic, light tasks; adjust text.verbosity. 
OpenAI

8) Performance & control tips (GPT‑5 specific)

Verbosity steering: prefer text.verbosity to prompt hacks for length control. 
OpenAI

Minimal reasoning: fastest path for extraction/formatting/classification; avoid for multi‑tool planning. 
OpenAI Cookbook

Parallel tools: set parallel_tool_calls:true and actually execute in parallel with asyncio or a thread pool. 
OpenAI Platform

Statefulness & caching: the Responses API keeps state; reusing previous_response_id can improve quality and efficiency; you can also request reasoning summaries or encrypted reasoning items if needed. 
OpenAI Cookbook

9) Reference snippets & where this comes from

GPT‑5 launch (tool calling, verbosity, minimal reasoning, custom tools). 
OpenAI

Function calling with Responses API (loop with function_call_output + previous_response_id). 
OpenAI Cookbook

Responses API statefulness & examples. 
OpenAI Cookbook

Parallel tool calls / parameter. 
OpenAI Platform

Custom tools & CFG (Lark/regex) examples for GPT‑5. 
OpenAI Cookbook

New built‑in tools & MCP support. 
OpenAI

10) A tiny self‑diagnostic you can run right now

If tool use still “does nothing,” try this single‑file test:

Start with the Python loop above.

Replace user_text with:
"What’s the current temperature in Paris (2.3522, 48.8566)? Use tools and then explain your result."

Log the first response.output—make sure you see function_call with name:"get_weather".

Return a synthetic output once to prove the loop works (e.g., {"temperature_c": 18.0}), then switch back to the real HTTP call. (If you need only real data even for tests, keep the HTTPX call enabled from the start.)

If you want, paste your failing request/response JSON and I’ll pinpoint the fix.

Appendix: Optional Node & cURL patterns

Node uses the same shapes (client.responses.create(...)) and the same loop; when streaming, handle SSE events and watch for function‑call items before the terminal response.completed. (See “Responses streaming” in the API docs.) 
OpenAI Platform

If you tell me exactly how your current request looks (model string, tools array, and the raw first response you get back), I’ll map it to the working loop above and show the one or two lines you need to change.

You said:
server.ts
TypeScript
polygon-tools.ts
TypeScript
ok, so i have this app, which is basically a trading assitant market data chat app, the backend is essentially comprised of these two files. right now it runs with the vercel ai sdk, but it's an old version of the sdk, and when i update it to the newest version it breaks. so i want to rip out the vercel ai sdk and work with open ai's api directly. please create a very detailed guide on how to do this
ChatGPT said:
Request for GPT-5 Pro
Reasoned for 16m 6s

Below is a surgical migration guide to remove the Vercel AI SDK and call OpenAI’s Responses API directly, with full tool‑calling support wired to your existing Polygon.io tools. I’ve tailored this to your two backend files (server.ts and polygon-tools.ts) and preserved your runtime behaviors (security PIN, market‑aware system prompt, multi‑tool orchestration, JSON response shape).

Where I reference API shapes/flags and the tool‑loop patterns, I cite OpenAI’s official docs/cookbooks so you can verify everything quickly:

Responses API is stateful and supports previous_response_id to chain turns. 
OpenAI Cookbook

Function‑calling with Responses API: JSON tool schema, strict: true, and the call/echo/output loop using function_call_output. 
OpenAI Cookbook

Parallel tool calls and in‑turn orchestration examples. 
OpenAI Cookbook

Node SDK usage + streaming event loop (stream: true). 
GitHub

GPT‑5‑specific controls (verbosity, minimal reasoning, free‑form tools—optional). 
OpenAI Cookbook

0) What changes—and what stays the same

You remove:

generateText from ai (Vercel AI SDK)

openai from @ai-sdk/openai

You keep:

Express, CORS, body parsing, dotenv, your PIN gate

Your Polygon code as-is (polygon-tools.ts). We’ll call its current execute functions directly.

Your endpoint shapes (/api/auth, /api/chat) and JSON response contract ({ response, toolCalls, usage })

You add:

Official OpenAI SDK (openai) and a thin tool loop around client.responses.create(...)

1) Install deps and clean up
# Remove the SDK you wanted to drop
pnpm remove ai @ai-sdk/openai  # or npm/yarn

# Add official OpenAI SDK (and keep your current deps)
pnpm add openai

# (You already have @polygon.io/client-js and zod in polygon-tools.ts)


Environment variables (unchanged concepts):

# .env (example)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5
POLYGON_API_KEY=...
ENTRY_PIN=12345678
DEBUG_MODE=false

2) How OpenAI’s Responses tool loop works (mental model)

You declare tools (JSON Schema).

Model may emit function_call items (one or many, and even in parallel).

You run the tool(s) and then send back function_call_output items with the same call_id, and continue the turn by referencing the previous_response_id.

Repeat until the model returns a normal assistant message (your final text).

This exact pattern (including strict: true and the feed‑back loop) is what OpenAI shows in the function-calling guide and o‑series tool‑calling guide. 
OpenAI Cookbook

3) Server rewrite (Express + OpenAI, no Vercel SDK)

Below is a drop‑in server.ts that replaces the old generateText(...) call.
Key bits:

Uses client.responses.create(...) (Responses API)

Declares your Polygon tools as OpenAI function tools (JSON Schema)

Calls your existing executors in polygon-tools.ts (no re-implementation)

Supports parallel tool calls (executes concurrently with Promise.all)

Returns your previous response JSON shape

Note: The example uses GPT‑5 controls text.verbosity and reasoning.effort (you can dial them). These are documented in the GPT‑5 cookbook. 
OpenAI Cookbook

// server.ts (OpenAI Responses API version)
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { polygonTools } from './tools/polygon-tools.js'; // keep your current file

dotenv.config();

// --- Runtime config
const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = Number(process.env.PORT || 3001);
const ENTRY_PIN = process.env.ENTRY_PIN || '12345678';
const MODEL = process.env.OPENAI_MODEL || 'gpt-5';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- 3.1 Tool definitions (OpenAI JSON Schema) ----------
/**
 * We expose your 8 Polygon functions as OpenAI "function" tools.
 * We keep schemas tight (strict: true) to avoid arg drift.
 */
const POLYGON_TOOL_DEFS = [
  {
    type: 'function',
    name: 'getDailyOpenClose',
    description: 'Get daily open, close, high, and low for a ticker on a given date.',
    parameters: {
      type: 'object',
      properties: {
        ticker:  { type: 'string', description: 'Ticker symbol, e.g., AAPL' },
        date:    { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
        adjusted:{ type: 'boolean', description: 'Return adjusted prices' }
      },
      required: ['ticker','date'],
      additionalProperties: false,
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getMultipleDailyOpenClose',
    description: 'Get daily OHLC for multiple tickers on a given date.',
    parameters: {
      type: 'object',
      properties: {
        tickers: { type: 'array', items: { type: 'string' }, description: 'Array of tickers' },
        date:    { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
        adjusted:{ type: 'boolean', description: 'Return adjusted prices' }
      },
      required: ['tickers','date'],
      additionalProperties: false,
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getOptionPrice',
    description: 'Get bid/ask/last and greeks for a single option contract.',
    parameters: {
      type: 'object',
      properties: {
        underlyingTicker: { type: 'string', description: 'Underlying ticker, e.g., AAPL' },
        strike:           { type: 'number', description: 'Strike price' },
        expirationDate:   { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
        optionType:       { type: 'string', enum: ['call','put'], description: 'Option type' },
      },
      required: ['underlyingTicker','strike','expirationDate','optionType'],
      additionalProperties: false,
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getOptionsChain',
    description: 'Get option prices for multiple underlyings by % moneyness band (ITM/OTM).',
    parameters: {
      type: 'object',
      properties: {
        tickers:        { type: 'array', items: { type: 'string' }, description: 'Array of underlyings' },
        expirationDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Expiration date YYYY-MM-DD' },
        optionType:     { type: 'string', enum: ['call','put'] },
        moneynessRange: {
          type: 'object',
          properties: { min: { type: 'number' }, max: { type: 'number' } },
          required: ['min','max'],
          additionalProperties: false,
          description: 'Percent band, e.g., 1..5 means 1%-5% OTM/ITM',
        },
        side:           { type: 'string', enum: ['otm','itm'] }
      },
      required: ['tickers','expirationDate','optionType','moneynessRange','side'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getOptionsChainByStrikes',
    description: 'Get option prices filtered by absolute strike range (not % moneyness).',
    parameters: {
      type: 'object',
      properties: {
        tickers:        { type: 'array', items: { type: 'string' }, description: 'Array of underlyings' },
        expirationDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        optionType:     { type: 'string', enum: ['call','put'] },
        strikeRange:    {
          type: 'object',
          properties: { min: { type: 'number' }, max: { type: 'number' } },
          required: ['min','max'],
          additionalProperties: false
        }
      },
      required: ['tickers','expirationDate','optionType','strikeRange'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getAggregates',
    description: 'Historical aggregate bars. Timespan = minute|hour|day; multiplier controls bar size.',
    parameters: {
      type: 'object',
      properties: {
        ticker:     { type: 'string' },
        multiplier: { type: 'integer', minimum: 1 },
        timespan:   { type: 'string', enum: ['minute','hour','day'] },
        from:       { type: 'string', description: 'YYYY-MM-DD or ISO' },
        to:         { type: 'string', description: 'YYYY-MM-DD or ISO' },
        adjusted:   { type: 'boolean' },
        sort:       { type: 'string', enum: ['asc','desc'] },
        limit:      { type: 'integer', minimum: 1, maximum: 50000 }
      },
      required: ['ticker','multiplier','timespan','from','to'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getLastTrade',
    description: 'Most recent trade for a ticker (real-time; includes pre/post market).',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string' }
      },
      required: ['ticker'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'function',
    name: 'getMultipleLastTrades',
    description: 'Most recent trades for multiple tickers (real-time).',
    parameters: {
      type: 'object',
      properties: {
        tickers: { type: 'array', items: { type: 'string' } }
      },
      required: ['tickers'],
      additionalProperties: false
    },
    strict: true
  }
] as const;

// ---------- 3.2 Wire executors to your existing polygon-tools.ts ----------
/**
 * We call the existing execute(...) functions you already wrote.
 * No business logic changes necessary.
 */
const EXECUTORS: Record<string, (args: any) => Promise<any>> = {
  getDailyOpenClose:          (args) => polygonTools.getDailyOpenClose.execute(args),
  getMultipleDailyOpenClose:  (args) => polygonTools.getMultipleDailyOpenClose.execute(args),
  getOptionPrice:             (args) => polygonTools.getOptionPrice.execute(args),
  getOptionsChain:            (args) => polygonTools.getOptionsChain.execute(args),
  getOptionsChainByStrikes:   (args) => polygonTools.getOptionsChainByStrikes.execute(args),
  getAggregates:              (args) => polygonTools.getAggregates.execute(args),
  getLastTrade:               (args) => polygonTools.getLastTrade.execute(args),
  getMultipleLastTrades:      (args) => polygonTools.getMultipleLastTrades.execute(args),
};

// ---------- 3.3 Utilities ----------
const safeJSONParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };

function buildSystemMessage(): string {
  const now = new Date();
  const easternTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const easternHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now));
  const dayOfWeek = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
  const isWeekday = !['Sat', 'Sun'].includes(dayOfWeek);
  const marketStatus = isWeekday && easternHour >= 9.5 && easternHour < 16 ? 'Open' : 'Closed';

  return `You are a helpful AI assistant with access to real-time market data through Polygon.io.
Current datetime: ${easternTime} ET
Market status: ${marketStatus}

Use tools for any **factual** market data (prices, OHLC, options, chains). Prefer chain tools for many strikes/tickers.
Summarize clearly; mention failures; compute concrete expiries when users say "next Friday", etc.`;
}

/**
 * Extract function calls from Responses API output.
 */
function getFunctionCalls(output: any[]): Array<{ name: string; arguments: string; call_id: string }> {
  const calls: any[] = [];
  for (const item of output) {
    if (item?.type === 'function_call' && item?.name && typeof item?.arguments === 'string' && item?.call_id) {
      calls.push({ name: item.name, arguments: item.arguments, call_id: item.call_id });
    }
  }
  return calls;
}

// ---------- 3.4 Core tool loop (non-streaming) ----------
async function runWithTools(inputMessages: Array<{ role: 'system'|'user'|'assistant'; content: string }>, opts?: { maxRounds?: number }) {
  const maxRounds = opts?.maxRounds ?? 10;
  const toolCallsLog: Array<{ toolName: string; args: any }> = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  // First call
  let response = await client.responses.create({
    model: MODEL,
    input: inputMessages,
    tools: POLYGON_TOOL_DEFS,
    parallel_tool_calls: true,                  // allow parallel calls when model chooses so
    temperature: 1,
    text: { verbosity: 'medium' },              // GPT‑5 control (doc’d in GPT‑5 cookbook)
    reasoning: { effort: 'minimal' },           // GPT‑5 control (doc’d in GPT‑5 cookbook)
  });

  for (let round = 0; round < maxRounds; round++) {
    // Collect usage
    if (response?.usage) {
      totalUsage.input_tokens  += response.usage.input_tokens ?? 0;
      totalUsage.output_tokens += response.usage.output_tokens ?? 0;
      totalUsage.total_tokens  += response.usage.total_tokens ?? 0;
    }

    const toolCalls = getFunctionCalls(response.output ?? []);
    if (!toolCalls.length) {
      // Final text ready
      return {
        text: response.output_text ?? '',
        toolCalls: toolCallsLog,
        usage: totalUsage,
      };
    }

    // Execute all tool calls concurrently
    const execs = await Promise.all(toolCalls.map(async (tc) => {
      const fn = EXECUTORS[tc.name];
      if (!fn) return { call_id: tc.call_id, output: JSON.stringify({ error: `Unknown tool: ${tc.name}` }) };
      const args = safeJSONParse(tc.arguments);
      toolCallsLog.push({ toolName: tc.name, args });
      try {
        const res = await fn(args);
        return { call_id: tc.call_id, output: typeof res === 'string' ? res : JSON.stringify(res) };
      } catch (err: any) {
        return { call_id: tc.call_id, output: JSON.stringify({ error: true, message: err?.message ?? String(err) }) };
      }
    }));

    // Feed back: include prior response.output AND function_call_output items, plus previous_response_id
    const followupInput: any[] = [...(response.output ?? [])];
    for (const ex of execs) {
      followupInput.push({ type: 'function_call_output', call_id: ex.call_id, output: ex.output });
    }

    response = await client.responses.create({
      model: MODEL,
      input: followupInput,
      tools: POLYGON_TOOL_DEFS,
      previous_response_id: response.id,        // chain this turn; keep reasoning/context
      parallel_tool_calls: true,
      temperature: 1,
      text: { verbosity: 'medium' },
      reasoning: { effort: 'minimal' },
    });
  }

  // Safety fallback if we exceed max rounds
  return {
    text: 'Aborted: too many tool rounds without a final answer.',
    toolCalls: toolCallsLog,
    usage: totalUsage,
  };
}

// ---------- 3.5 Routes ----------
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth', (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  if (pin === ENTRY_PIN) return res.json({ success: true });
  return res.status(401).json({ error: 'Invalid PIN' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], pin } = req.body || {};
    if (pin !== ENTRY_PIN) return res.status(401).json({ error: 'Unauthorized' });
    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    if (!process.env.POLYGON_API_KEY) return res.status(500).json({ error: 'Missing POLYGON_API_KEY' });

    // Build messages: system + prior turns (if any) + new user msg
    const systemMessage = buildSystemMessage();
    const msgs: Array<{ role: 'system'|'user'|'assistant'; content: string }> = [
      { role: 'system', content: systemMessage },
      ...conversationHistory, // expecting array of {role, content} from your client
      { role: 'user', content: message }
    ];

    const result = await runWithTools(msgs, { maxRounds: 50 });

    res.json({
      response: result.text,
      toolCalls: result.toolCalls, // [{ toolName, args }, ...]
      usage: result.usage
    });
  } catch (err: any) {
    console.error('Error in /api/chat:', err);
    res.status(500).json({ error: 'Failed to process chat request', details: err?.message ?? String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  console.log(`   Health: GET  /health`);
  console.log(`   Chat:   POST /api/chat`);
});


Why this works:

We pass function tools with strict: true, so the model must populate required args per schema. 
OpenAI Cookbook

We detect function_call items, run your existing executors, then send back function_call_output items plus previous_response_id. This is the exact Responses API pattern to keep in‑turn state/reasoning. 
OpenAI Cookbook
+1

parallel_tool_calls: true lets GPT decide to fan‑out; we run them concurrently with Promise.all. 
OpenAI Cookbook

4) Optional: add streaming to the browser (SSE)

The official Node SDK exposes an async iterable when stream: true. For a simple server‑push SSE endpoint:

// OPTIONAL: stream only the *final* text (after tool rounds) to the browser.
app.get('/api/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const systemMessage = buildSystemMessage();
  const user = String(req.query.q || 'Ping');
  // First run tools *non-streaming*
  const interim = await client.responses.create({
    model: MODEL,
    input: [{ role: 'system', content: systemMessage }, { role: 'user', content: user }],
    tools: POLYGON_TOOL_DEFS,
    parallel_tool_calls: true
  });

  // If the model already answered, stream nothing more; else continue
  const toolCalls = getFunctionCalls(interim.output ?? []);
  if (!toolCalls.length) {
    res.write(`data: ${JSON.stringify({ delta: interim.output_text })}\n\n`);
    return res.end();
  }

  // ...execute tools and prepare follow-up input (same as runWithTools), then:
  // const stream = await client.responses.create({ ..., stream: true });
  // for await (const event of stream) { res.write(`data: ${JSON.stringify(event)}\n\n`) }
  // res.end();

  res.write(`data: ${JSON.stringify({ info: 'Streaming with tool-calls is possible but more involved; see OpenAI README streaming pattern' })}\n\n`);
  res.end();
});


Basic streaming loop pattern (Node SDK): for await (const event of stream). 
GitHub

If you want true streaming including function call deltas, parse streamed events and pause output while tools execute, then resume by continuing the turn with previous_response_id. The cookbook + README cover the event stream shapes and sequencing. 
GitHub
OpenAI Cookbook

5) (Optional) Replace your custom webTools with hosted web search

If your old app merged polygonTools with a webTools module, you can swap that for the built‑in web_search_preview tool in the Responses API. Add this to the tools array (with your user’s coarse location if needed), then keep the same tool loop:

const tools = [
  ...POLYGON_TOOL_DEFS,
  {
    type: 'web_search_preview',
    user_location: { type: 'approximate', country: 'US', region: 'NY', city: 'NYC' },
    search_context_size: 'medium'
  }
];


The multi‑tool orchestration cookbook shows mixing built‑ins with custom functions in one call. 
OpenAI Cookbook

6) Failure‑mode checklist (why tool use “doesn’t work”)

Forgot to send tool output back → Always emit {"type":"function_call_output","call_id":"...","output":"..."} for each call, and repeat responses.create with previous_response_id. 
OpenAI Cookbook

Didn’t echo prior output → Include all items from the previous response.output in the next input. That preserves the model’s reasoning & in‑turn context. 
OpenAI Cookbook

Schema mismatch → Use minimal JSON Schema, mark required fields, set additionalProperties:false, and strict:true. 
OpenAI Cookbook

Parallel fan‑out but serial executor → If you pass parallel_tool_calls:true, run your executors concurrently (we used Promise.all). 
OpenAI Cookbook

Model didn’t pick a tool → You can force with tool_choice: "required" or target a specific function with tool_choice: { type: "function", name: "getLastTrade" }. (Same Responses API flags; see function-calling guide.) 
OpenAI Cookbook

7) Performance & control (trading‑grade tips)

Parallelize tool calls: the model will often ask for several tickers/strikes at once—concurrency keeps you real‑time. 
OpenAI Cookbook

For terse answers in UI, set text: { verbosity: "low" }; for audit/debug explainers use "high". (GPT‑5 control.) 
OpenAI Cookbook

For fast IO‑bound tasks (your case), reasoning: { effort: "minimal" } reduces latency. 
OpenAI Cookbook

Keep tool descriptions specific (when to use which Polygon function) to raise call accuracy; this is recommended in the function‑calling guide. 
OpenAI Cookbook

8) End‑to‑end migration diff (what you change in your code)

Old imports (remove):

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';


New imports (add):

import OpenAI from 'openai';


Old call (remove):

const result = await generateText({
  model: openai('gpt-5-2025-08-07'),
  messages,
  temperature: 1,
  tools,
  maxToolRoundtrips: 50,
});


New call (replace with the loop shown in §3.4):

const result = await runWithTools(messages, { maxRounds: 50 });
// returns { text, toolCalls, usage }


Return shape (unchanged):

res.json({ response: result.text, toolCalls: result.toolCalls, usage: result.usage });


You do not need to rewrite polygon-tools.ts. Its execute(...) functions get called directly by EXECUTORS[...].

9) Advanced options (optional)

Streaming from the first token with tool calls mid‑stream is possible; you’ll parse streamed events (response.*.delta), buffer arguments until a full function_call arrives, run the tool, then continue the stream using previous_response_id. The Node README shows the stream loop; pair that with the function‑calling loop from the cookbooks to do fully streaming agents. 
GitHub
OpenAI Cookbook

Hosted tools + MCP: if you later expose your own retrieval/search infra as MCP, you can mix those tools with Polygon in the same tools array and constrain the surface via allowed_tools. (See cookbook guidance.) 
OpenAI Cookbook

10) Sanity checks before you flip the switch

Confirm model + key: OPENAI_API_KEY set, OPENAI_MODEL=gpt-5.

Hit /health.

Call /api/chat with { pin, message: "What’s SPY last trade?" } and confirm the model produces a function_call → getLastTrade, then a final text.

Ask for multiple tickers or a chain to confirm parallel calls.

Turn on DEBUG_MODE=true to see your Polygon calls in the server logs from polygon-tools.ts.

References (official)

Function calling with Responses API (JSON tool schema, strict mode, call/output loop). 
OpenAI Cookbook

Responses API statefulness and previous_response_id (continue/fork turns). 
OpenAI Cookbook

Parallel tool orchestration examples (multi‑tool, RAG, built‑ins). 
OpenAI Cookbook

Node SDK streaming (for await (const event of stream)). 
GitHub

GPT‑5 controls (verbosity, minimal reasoning, custom tools). 
OpenAI Cookbook

....