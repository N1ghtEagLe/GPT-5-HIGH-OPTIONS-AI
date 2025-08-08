import { z } from 'zod';
import OpenAI from 'openai';

// Web search tool powered by OpenAI Responses API web_search (preview)
// For background/context only (news, filings, transcripts). Not for market prices.
export const webTools = {
  webSearch: {
    description: 'Web search for background context (news, company info, filings, earnings transcripts). Returns top links with titles and snippets. Not for real-time market prices.',
    parameters: z.object({
      query: z.string().min(2).describe('Search query, e.g., "Apple earnings call transcript Q2 2025"'),
      maxResults: z.number().int().min(1).max(10).optional().describe('Maximum number of results to return (default 5)')
    }),
    execute: async ({ query, maxResults }: { query: string; maxResults?: number }) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return { error: true, message: 'OpenAI API key not configured', details: 'Set OPENAI_API_KEY in environment' };
      }

      const client = new OpenAI({ apiKey });
      const limit = maxResults ?? 5;

      try {
        const res: any = await client.responses.create({
          model: 'gpt-5-2025-08-07',
          instructions:
            'Use the web_search tool to find authoritative, recent sources. Return only background/context (news, filings, transcripts). Do not include stock/option prices. Respond STRICTLY as minified JSON object with key "results" (array of {title,url,snippet}).',
          input: `Query: ${query}\nReturn up to ${limit} results.`,
          tools: [{ type: 'web_search_preview' }],
          parallel_tool_calls: true
        });

        // Extract text from the Responses API
        const text: string | undefined = (res as any).output_text
          ?? (res as any).output?.[0]?.content?.[0]?.text
          ?? (res as any).choices?.[0]?.message?.content
          ?? (typeof (res as any).content === 'string' ? (res as any).content : undefined);

        if (!text) {
          return { error: true, message: 'Empty response from web_search' };
        }

        // Attempt to parse JSON from text (strip code fences)
        let jsonText = text.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        }
        let parsed: any;
        try {
          parsed = JSON.parse(jsonText);
        } catch {
          const match = jsonText.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (!parsed || !Array.isArray(parsed.results)) {
          return { error: true, message: 'Unexpected web_search response format', details: text.slice(0, 300) };
        }

        const results = parsed.results.slice(0, limit);
        return { query, provider: 'openai-web', total: results.length, results };
      } catch (err: any) {
        return { error: true, message: 'Web search failed', details: err?.message || String(err) };
      }
    }
  }
};

export type WebTools = typeof webTools; 