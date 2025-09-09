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
}: {
  model: string;
  messages: ChatMessage[];
  tools: Record<string, ToolSpec>;
  temperature?: number;
  maxToolRoundtrips?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Sanitize messages to role/content only
  const sanitized = messages.map((m: any) => ({ role: m.role, content: m.content })) as ChatMessage[];

  const client = new OpenAI({ apiKey });
  const toolDefs = toOpenAITools(tools);
  const executed: Array<{ toolName: string; args: any }> = [];

  let response: any = await client.responses.create({
    model,
    reasoning: { effort: 'high' },
    temperature,
    input: sanitized as any,
    tools: toolDefs,
    parallel_tool_calls: true,
  } as any);

  let rounds = 0;
  while (
    response?.status === 'requires_action' &&
    response?.required_action?.type === 'submit_tool_outputs' &&
    rounds < maxToolRoundtrips
  ) {
    rounds++;
    const toolCalls = response.required_action.submit_tool_outputs.tool_calls || [];
    const outputs = await Promise.all(
      toolCalls.map(async (tc: any) => {
        const name: string = tc.name || tc.function?.name;
        const args = safeParseArgs(tc.arguments ?? tc.function?.arguments);
        executed.push({ toolName: name, args });
        const tool = tools[name];
        let output: any;
        try {
          if (!tool) throw new Error(`Tool not found: ${name}`);
          output = await tool.execute(args);
        } catch (err: any) {
          output = { error: true, message: err?.message || String(err) };
        }
        return { tool_call_id: tc.id, output: JSON.stringify(output) };
      })
    );

    const responsesAny = (client as any).responses;
    const submitFn = responsesAny?.['submitToolOutputs'] ?? responsesAny?.['submit_tool_outputs'];
    if (typeof submitFn !== 'function') {
      throw new Error('OpenAI SDK does not expose responses.submitToolOutputs in this version');
    }
    response = await submitFn({
      response_id: response.id,
      tool_outputs: outputs,
    });
  }

  const text = extractText(response);
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
