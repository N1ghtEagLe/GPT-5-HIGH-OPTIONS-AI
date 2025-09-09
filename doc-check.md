TL;DR answers (with doc pointers)

1) Tool schema shape in responses.create

In the Responses API, each custom function tool is a flat object:

{
  type: 'function',
  name: 'get_weather',
  description: '…',
  parameters: { /* JSON Schema */ },
  strict: true
}


It is not nested under a function key (that nesting was used by older Chat Completions examples). See the official function‑calling cookbook: they define tools exactly as {"type":"function","name":...,"parameters":{...}}. 
OpenAI Cookbook

2) How to send chat context

You can send:

A plain string: input: "Tell me a joke", or

A message array with roles and content parts (e.g., {type:"input_text"}, {type:"input_image"}) for multimodal turns:

input: [{
  role: 'user',
  content: [
    { type: 'input_text', text: '…' },
    // optionally: { type: 'input_image', image_url: '…' }
  ]
}]


Both shapes are shown in the official “Web Search and States with Responses API” page. 
OpenAI Cookbook

instructions (system/developer prompt) is a separate, optional top‑level field you can include on any call; conversation state comes from previous_response_id, not from reusing instructions. You can change instructions per turn. Cookbook examples show the Responses object carrying an instructions field and demonstrate continuing a turn with previous_response_id. 
OpenAI Cookbook
+1

3) Expected tool‑call flow for function tools

In Responses API, function tools do not use status: "requires_action" or responses.submitToolOutputs. That flow belongs to the Assistants API (runs.submitToolOutputs). 
OpenAI Platform

Instead, the model returns inline items of type function_call inside response.output. You then:

run your function(s), and

call responses.create again with:

previous_response_id: <the prior response.id>, and

one input item per tool result using type: "function_call_output", carrying the same call_id:

{ "type": "function_call_output", "call_id": "<same id>", "output": "<string or JSON>" }


The official cookbook shows this exact loop and data types (including call_id, function_call, and function_call_output). 
OpenAI Cookbook

Minimal, correct Node/TS example (Responses API + custom function tool)

This demonstrates the official shapes: flat function tools, message inputs, function_call → function_call_output, and previous_response_id.

import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/** 1) Declare your function tools (flat schema; strict JSON Schema recommended) */
const TOOLS = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get current temperature (°C) by coordinates.',
    parameters: {
      type: 'object',
      properties: {
        latitude:  { type: 'number' },
        longitude: { type: 'number' }
      },
      required: ['latitude', 'longitude'],
      additionalProperties: false
    },
    strict: true
  }
] as const;

/** 2) Your real executor for the tool (example implementation) */
async function get_weather(args: { latitude: number; longitude: number }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(args.latitude));
  url.searchParams.set('longitude', String(args.longitude));
  url.searchParams.set('current', 'temperature_2m');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather http ${r.status}`);
  const data = await r.json();
  return { temperature_c: data.current.temperature_2m };
}

/** 3) A small dispatcher (add more functions as you add tools) */
const EXECUTORS: Record<string, (a: any) => Promise<any>> = {
  get_weather
};

/** 4) One turn with tool-calling (stateful pattern) */
export async function askWeather() {
  // 4a) First call: give instructions + user message + tools
  const first = await client.responses.create({
    model: 'gpt-5',
    instructions: 'You are a precise coding agent. Use tools for any factual data.',
    input: [{
      role: 'user',
      content: [{ type: 'input_text', text: 'What is the temperature in Paris? Use tools.' }]
    }],
    tools: TOOLS,
    // Optional knobs:
    parallel_tool_calls: true,
    reasoning: { effort: 'minimal' },
    text: { verbosity: 'low' }
  });

  // 4b) Did the model request any function tools?
  const toolCalls = (first.output ?? []).filter((x: any) => x?.type === 'function_call');

  if (toolCalls.length === 0) {
    // Model answered directly
    return first.output_text;
  }

  // 4c) Execute all tool calls (parallel-safe)
  const outputs = await Promise.all(toolCalls.map(async (tc: any) => {
    const fn = EXECUTORS[tc.name];
    if (!fn) return { call_id: tc.call_id, output: JSON.stringify({ error: `Unknown tool ${tc.name}` }) };
    const args = JSON.parse(tc.arguments || '{}');
    try {
      const result = await fn(args);
      return { call_id: tc.call_id, output: typeof result === 'string' ? result : JSON.stringify(result) };
    } catch (e: any) {
      return { call_id: tc.call_id, output: JSON.stringify({ error: true, message: e?.message ?? String(e) }) };
    }
  }));

  // 4d) Follow-up call: send tool outputs + previous_response_id (no submitToolOutputs in Responses API)
  const second = await client.responses.create({
    model: 'gpt-5',
    previous_response_id: first.id,          // keep the conversation state
    input: outputs.map(o => ({
      type: 'function_call_output',
      call_id: o.call_id,
      output: o.output
    })),
    tools: TOOLS,
    reasoning: { effort: 'minimal' },
    text: { verbosity: 'low' }
  });

  return second.output_text;
}


The tool definitions match the official flat function schema for the Responses API (no function: {…} nesting). 
OpenAI Cookbook

We demonstrate both string and content‑parts inputs; the latter is the recommended format for multimodal. 
OpenAI Cookbook

The flow is: model emits function_call → you run the tool → you send back function_call_output + previous_response_id in a second responses.create call. This exactly mirrors the cookbook. 
OpenAI Cookbook

Two official orchestration patterns you’ll see in docs

You’ll see both of these in official material; pick one based on how much control you want:

Stateful, minimal (recommended to start):

Send only the new tool outputs as input, and set previous_response_id; the API remembers the turn state. (This is what the example above does.) 
OpenAI Cookbook

Stateless, full‑control (you manage the whole transcript):

Maintain your own context array of items and append the entire response.output (including any reasoning item) plus your tool outputs before the next call. This maximizes model “awareness” and is shown explicitly in the reasoning cookbook. 
OpenAI Cookbook

“Paste from the docs” snippets (short & canonical)

Tool result item you send back (shape shown verbatim in the cookbook):

{ "type": "function_call_output", "call_id": "<id>", "output": "…" }


OpenAI Cookbook

Multimodal input (role + content parts) is documented and used in Responses examples: user content uses [{ type: "input_text", text: "…" }, …]. 
OpenAI Cookbook

Assistant‑style requires_action/submitToolOutputs is not used here. That pattern is documented under the Assistants API Runs (runs.submitToolOutputs). 
OpenAI Platform

Subtleties that commonly trip teams up

Wrong tool object shape

Use the flat {"type":"function","name":...,"parameters":{...}} form in Responses. Don’t wrap it in a function: { … } object (that’s from older Chat Completions examples). 
OpenAI Cookbook

Expecting requires_action

That belongs to the Assistants API. In Responses, watch for function_call items, then reply with function_call_output via another responses.create (with previous_response_id). 
OpenAI Cookbook
OpenAI Platform

Not returning outputs for every call_id

If the model made multiple calls (often with parallel_tool_calls: true), you must send an output item for each call_id. The cookbook shows handling multiple calls. 
OpenAI Cookbook

Input shape mismatches

For plain text, input: "…". For multimodal or richer control, use [{ role, content: [{ type: "input_text", text: "…" }, …] }]. 
OpenAI Cookbook

Stateful vs stateless confusion

If you use previous_response_id, you don’t need to re‑echo the prior output items; the API keeps the thread. If you run stateless, you must append prior items yourself (including any reasoning item) before the next call. Both patterns are documented. 
OpenAI Cookbook
+1

One more Node variant: explicit “messages” + forced tool use

Sometimes you want to force a specific tool or ensure at least one tool is used:

const resp = await client.responses.create({
  model: 'gpt-5',
  instructions: 'Use tools for factual market data.',
  input: [
    { role: 'user', content: [{ type: 'input_text', text: 'Price check for AAPL and MSFT.' }] }
  ],
  tools: TOOLS,
  tool_choice: 'required', // or { type: 'function', name: 'get_weather' }
  parallel_tool_calls: true
});


tool_choice usage and multi‑tool orchestration are covered in the official cookbooks. 
OpenAI Cookbook
+1

Sources you can double‑check

Handling Function Calls with Reasoning Models (Responses API; function_call/function_call_output; flat tool schema; previous_response_id). 
OpenAI Cookbook

Web Search & States with Responses API (shows message shapes and previous_response_id continuation). 
OpenAI Cookbook

Better performance from reasoning models using the Responses API (shows response object with instructions, and how to carry/structure reasoning items across turns). 
OpenAI Cookbook

Assistants API – submit tool outputs (for comparison; not used by Responses). 
OpenAI Platform

If you paste your current failing payload (tool array + your first responses.create result), I’ll map it to the working loop above and point out the exact field(s) that need to change.