# AI Market Data Assistant

An AI-powered trading assistant chat app that uses OpenAI’s Responses API and Polygon.io to answer market questions, price options, and analyze uploaded chart screenshots.

## Features

- Interactive AI chat using OpenAI Responses API (model: `gpt-5-2025-08-07`, reasoning effort high)
- Real-time market data via Polygon.io (prices, aggregates, option chains, snapshots)
- Tool loop with parallel tool calls for reliable, evidence-based answers
- Image understanding: paste/drag chart screenshots; model analyzes technicals
- Table-first pricing: all quotes and pricing are returned as markdown tables

## Frontend UX (Next.js)

- Paste or drag-and-drop chart images directly into the input.
- Thumbnails show before sending; processing state changes to “Attached ✓”.
- Auto-carry last chart: if you don’t attach a new image, the previous chart is automatically included in follow-up messages.
- One-click “×” to stop auto-including the previous chart for subsequent messages.

Image constraints (MVP):
- Types: `image/png`, `image/jpeg`, `image/webp`
- Max per message: 3 images
- Client-side compression: max dimension ~1600px, JPEG/WebP quality ~0.8
- Images are sent inline (base64 data URL) with `detail: 'high'`

## Backend (Express)

- PIN auth on every request (`ENTRY_PIN`).
- Body size limit increased for base64 images (JSON 20 MB).
- OpenAI Responses API with tool loop (parallel tool calls on).
- Multimodal: images are attached to the last user message as `input_image` items via `image_url` (data URLs) and `detail: 'high'`.
- Strict formatting in system prompt: any quotes/pricing must be returned as markdown tables first (no prose above tables).

## Available Tools

Polygon tools (`src/tools/polygon-tools.ts`):
- `getDailyOpenClose`: Daily OHLC for a ticker and date.
- `getMultipleDailyOpenClose`: Daily OHLC for multiple tickers (parallel).
- `getLastTrade`: Most recent trade for a ticker.
- `getMultipleLastTrades`: Last trade for multiple tickers (parallel).
- `getAggregates`: Historical aggregates (minute/hour/day) between two times.
- `getOptionsChain`: Options filtered by moneyness range (% OTM/ITM); returns bid/ask/mid/last, IV, OI, Greeks per contract.
- `getOptionsChainByStrikes`: Options filtered by absolute strike range; returns bid/ask/mid/last, IV, OI, Greeks per contract.
- `getOptionPrice`: Price + snapshot for a single explicit contract (use only for single contract; chains already include pricing/greeks).

Native web search (OpenAI Responses API `web_search_preview`):
- Used for background/context (news, filings, transcripts) only; never for prices/quotes.

## Pricing Output Rules (Enforced)

- Pricing and quotes MUST be in markdown tables; the first content in a pricing response is a table (header + dashed separator).
- Options chain tables: include Strike, Bid, Ask, Last (or Mid), and additional columns when requested (IV, OI, Volume, %OTM/ITM).
- Multi-leg structures: provide a legs table with columns like Leg, Side, Type, Strike, Expiry, Bid, Ask, Last, Mid; include a concise Net Credit/Debit summary.
- No bullets for quotes; prose can follow tables for commentary.

## Chart Image Analysis

When you paste a chart screenshot, the model:
- Extracts what’s visible: meta (ticker/venue/timeframe), overlays/regime (MAs, VWAPs, bands), structure (trend/ranges/patterns/gaps), momentum (RSI/MACD), volume/participation, key levels, visible events.
- Optionally enriches with Polygon data matched to the chart’s timeframe: spot, RV/HV/ATR, IV and IV Rank, term structure, expected move, skew metrics, flow/positioning if available, earnings proximity.
- Keeps calculations targeted; may ask for a single additional overlay if it materially helps (e.g., “Add Anchored VWAP from earnings gap”).

## Setup

1) Root `.env` (backend):
- `OPENAI_API_KEY=sk-...`
- `POLYGON_API_KEY=...`
- `ENTRY_PIN=12345678` (or your PIN)

2) Frontend `.env`:
- Copy `frontend/env.example` to `frontend/.env.local` and set:
- `NEXT_PUBLIC_API_URL=http://localhost:3001`

3) Install dependencies:
- `npm install`
- `cd frontend && npm install`

## Run

- Backend: `npm run server` (or `npm run server:dev`)
- Frontend: `cd frontend && npm run dev`

Visit `http://localhost:3000` and enter your PIN.

## Example Questions

- “Show me AAPL daily OHLC for 2024-01-15.”
- “Price a 2–5% OTM call chain for MSFT for 2025-12-19.”
- “Risk reversal candidates for GOOGL Jan 2026 — table only.”
- “Paste a chart: identify trend, key levels, and expected move.”

## Notes & Limits

- Image uploads are inline; no external storage. Reloading clears the carried chart.
- Up to 3 images per message; large images are compressed client-side.
- The app enforces tables for pricing; narrative may follow tables.

## Troubleshooting

- 400 “unknown parameter” to OpenAI: ensure images are sent as `input_image` with `image_url` (data URL) and valid MIME.
- No tables in output: confirm the prompt changes are loaded (restart backend) and that you’re on this code.
- Auth fails: ensure `ENTRY_PIN` matches what you type.
- Frontend 401/404: confirm `NEXT_PUBLIC_API_URL` points to the backend.
