import OpenAI from 'openai';
import process from 'node:process';
import { toOpenAITools } from './zod-to-jsonschema.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

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
  images,
}: {
  model: string;
  messages: ChatMessage[];
  tools: Record<string, ToolSpec>;
  temperature?: number;
  maxToolRoundtrips?: number;
  images?: Array<{ mimeType: string; dataBase64?: string; url?: string }>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Sanitize messages to role/content only
  const sanitized = messages.map((m: any) => ({ role: m.role, content: m.content })) as ChatMessage[];

  const client = new OpenAI({ apiKey });
  const toolDefs = toOpenAITools(tools);
  // Include OpenAI's native web search tool directly
  const allToolDefs: any[] = [...toolDefs, { type: 'web_search_preview' }];
  const executed: Array<{ toolName: string; args: any }> = [];

  // Use Responses API recommended fields: instructions + input (messages)
  let instructions: string | undefined;
  let convo = sanitized;
  if (sanitized.length > 0 && sanitized[0].role === 'system') {
    instructions = sanitized[0].content;
    convo = sanitized.slice(1);
  }

  // Convert user/assistant messages into Responses input parts
  const inputMessages: any[] = convo
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role,
      content: [
        m.role === 'user'
          ? { type: 'input_text', text: String(m.content ?? '') }
          : { type: 'output_text', text: String(m.content ?? '') }
      ]
    }));

  // If images are provided for this turn, attach them to the last user message
  if (images && images.length > 0) {
    const lastUserIndex = (() => {
      for (let i = inputMessages.length - 1; i >= 0; i--) {
        if (inputMessages[i]?.role === 'user') return i;
      }
      return -1;
    })();

    if (lastUserIndex >= 0) {
      const imgParts = images
        .filter(img => (img?.dataBase64 || img?.url) && (img?.mimeType || img?.url))
        .map(img => {
          if (img.url) {
            return { type: 'input_image', image_url: img.url, detail: 'high' } as any;
          }
          const dataUrl = `data:${img.mimeType};base64,${img.dataBase64}`;
          return { type: 'input_image', image_url: dataUrl, detail: 'high' } as any;
        });
      if (imgParts.length > 0) {
        inputMessages[lastUserIndex].content.push(...imgParts);
      }
    }
  }

  try {
    console.log(`[LLM] create: model=${model}, messages=${sanitized.length}, tools=${toolDefs.length}`);
    if (instructions) console.log(`[LLM] instructions length=${instructions.length}`);
  } catch {}

  let response: any = await client.responses.create({
    model,
    reasoning: { effort: 'high' },
    temperature,
    instructions,
    input: inputMessages as any,
    tools: allToolDefs,
    parallel_tool_calls: true,
  } as any);

  try {
    console.log(`[LLM] initial status=${response?.status}`);
  } catch {}

  let rounds = 0;
  while (rounds < maxToolRoundtrips) {
    const functionCalls = collectFunctionCalls(response);
    if (functionCalls.length === 0) break;
    console.log(`[LLM] function_calls=${functionCalls.length}`);

    const outputs = await Promise.all(functionCalls.map(async (fc) => {
      const name = fc.name;
      const args = safeParseArgs(fc.arguments);
      try {
        console.log(`[LLM] tool_call: ${name}(${truncate(JSON.stringify(args), 300)})`);
      } catch {}
      executed.push({ toolName: name, args });
      const tool = tools[name];
      let result: any;
      try {
        if (!tool) throw new Error(`Tool not found: ${name}`);
        result = await tool.execute(args);
      } catch (err: any) {
        result = { error: true, message: err?.message || String(err) };
      }
      const outputStr = typeof result === 'string' ? result : JSON.stringify(result);
      try {
        console.log(`[LLM] tool_result: ${name} -> ${truncate(outputStr, 300)}`);
      } catch {}
      return { call_id: fc.call_id, output: outputStr };
    }));

    const outputItems = outputs.map(o => ({
      type: 'function_call_output',
      call_id: o.call_id,
      output: o.output,
    }));

    rounds++;
    response = await client.responses.create({
      model,
      previous_response_id: response.id,
      input: outputItems as any,
      tools: allToolDefs,
      reasoning: { effort: 'high' },
      parallel_tool_calls: true,
    } as any);

    try {
      console.log(`[LLM] follow-up status=${response?.status}`);
    } catch {}
  }

  const text = extractText(response);
  try {
    console.log(`[LLM] final text length=${text?.length || 0}`);
    if (!text || text.length === 0) {
      console.log(`[LLM] warning: empty text; output summary: ${summarizeOutput(response)}`);
    }
  } catch {}
  const usage = (response as any)?.usage ?? undefined;
  return { text, toolCalls: executed, usage };
}

function safeParseArgs(input: any) {
  if (input && typeof input === 'object') return input;
  try {
    return JSON.parse(String(input));
  } catch {
    return {};
  }
}

function extractText(res: any): string {
  if (!res) return '';
  // Prefer output_text if present
  if (typeof res.output_text === 'string' && res.output_text.length > 0) {
    return res.output_text;
  }
  // Walk output array and join text parts
  const parts: string[] = [];
  const arr = Array.isArray(res.output) ? res.output : [];
  for (const item of arr) {
    if (item?.type === 'message') {
      const content = item?.content || [];
      for (const c of content) {
        if (typeof c?.text === 'string') parts.push(c.text);
      }
    }
    if (item?.type === 'output_text' && typeof item?.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n').trim();
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

function summarizeOutput(res: any) {
  try {
    const status = res?.status;
    const count = Array.isArray(res?.output) ? res.output.length : 0;
    const types = Array.isArray(res?.output) ? res.output.map((x: any) => x?.type).join(',') : 'n/a';
    return `{status:${status}, outputCount:${count}, types:[${types}]}`;
  } catch {
  return 'unavailable';
  }
}

function collectFunctionCalls(res: any): Array<{ call_id: string; name: string; arguments: any }> {
  const calls: Array<{ call_id: string; name: string; arguments: any }> = [];
  const arr = Array.isArray(res?.output) ? res.output : [];
  for (const item of arr) {
    if (item?.type === 'function_call') {
      const call_id = item?.call_id || item?.id || '';
      const name = item?.name || item?.function?.name || '';
      const args = item?.arguments ?? item?.function?.arguments ?? {};
      if (call_id && name) calls.push({ call_id, name, arguments: args });
    }
  }
  return calls;
}
