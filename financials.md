# Polygon Financials Tool Implementation Plan

## Goals
- Expose Polygon's `/vX/reference/financials` endpoint through a new backend tool so the assistant can retrieve company fundamentals.
- Allow the assistant to request both quarterly and annual data, with arbitrary horizons (e.g., 4 sequential quarters, 5 years of annual statements) while keeping responses concise.
- Return only the line items the user/model needs (e.g., revenue, net income, gross margin, cash from operations) to avoid overwhelming the chat transcript.

## Backend Changes

### 1. Tool Definition (`src/tools/polygon-tools.ts`)
- Add `getFinancials` tool using `polygonClient.reference.financials`.
- Parameters (zod schema):
  - `ticker`: string (required).
  - `timeframe`: enum `['quarterly', 'annual', 'ttm']` (default `quarterly`).
  - `limit`: number (1-20?) default 4.
  - Optional filters: `sort`, `order`, `filingDateRange`, `fiscalPeriod`, `fiscalYear`, `reportType`.
  - `metrics`: optional array of metric keys (e.g., `['revenue', 'net_income', 'eps_basic']`).
  - `statements`: optional array limiting to `['income_statement','balance_sheet','cash_flow_statement','comprehensive_income']`.
- Execution logic:
  1. Call Polygon endpoint with provided filters, respecting pagination (follow `next_url` until we have `limit` results or polygon stops).
  2. Normalize each filing to a compact structure:
     ```ts
     interface FinancialSnapshot {
       filingDate: string;
       periodEnd: string;
       fiscalPeriod: string;
       fiscalYear: string;
       reportType: string;
       statementData: {
         [statement: string]: {
           [metricKey: string]: {
             label: string;
             unit: string;
             value: number | null;
           };
         };
       };
     }
     ```
  3. If `metrics` is provided, map high-level keys to actual polygon paths (e.g., `metricsMap['net_income'] = ['income_statement','net_income_loss']`). Only include those entries in the response. If `statements` provided without `metrics`, keep all line items within selected statements.
  4. Provide helper to compute derived values if needed (e.g., `gross_margin = gross_profit / revenue`), but start with raw values.

### 2. Utility for Metric Mapping
- Create `src/tools/helpers/financial-metrics.ts` exporting:
  - `METRIC_DEFINITIONS`: maps friendly names to polygon paths and display labels.
  - Possibly include grouping (income vs balance sheet) for formatting.
- Support both base metrics and future derived metrics.

### 3. Response Formatting (Model Contracts)
- Within the tool output, include enough metadata for the assistant to render tables:
  ```json
  {
    "ticker": "MSFT",
    "timeframe": "quarterly",
    "metrics": ["revenue", "net_income", "eps_diluted"],
    "results": [
      {
        "period": "2024 Q4",
        "filingDate": "2024-07-30",
        "data": {
          "revenue": { "label": "Revenue", "unit": "USD", "value": 76441000000 },
          "net_income": { "label": "Net Income", "unit": "USD", "value": 27233000000 },
          "eps_diluted": { "label": "EPS (Diluted)", "unit": "USD/sh", "value": 3.65 }
        }
      }
    ]
  }
  ```
- This makes it easy for the assistant to produce a markdown table with columns `[Period, Revenue, Net Income, EPS (Diluted)]`.

### 4. Pagination Handling
- If `limit` exceeds Polygon's max per call or we need older filings, follow `next_url` and concatenate results (up to a safe cap, e.g., 20 total entries to keep responses manageable).

### 5. Error Handling
- Return structured errors when Polygon responds with API errors (missing API key, invalid ticker, etc.), similar to other tools.

## Frontend/Client Considerations
- No immediate client changes: the chat already renders tables. Opportunity: extend the charting pipeline later to plot fundamentals trends.
- Possibly add guardrails to highlight when too many metrics are requested (table width) and ask the model to split.

## System Prompt Updates (`src/server.ts` and CLI)
Add a new section under Polygon tool guidelines:
- Describe `getFinancials` usage:
  - When users ask for fundamental metrics, run `getFinancials` with the appropriate `timeframe` and `limit`.
  - Encourage the assistant to request only needed metrics via the `metrics` argument.
  - Remind that output must be formatted as markdown tables (one row per filing).
  - Encourage the assistant to clarify timeframe or number of periods if unspecified (default to 4 quarters or 5 annual filings).
  - Note derived metrics should be computed after retrieval if needed.
- Example instructions snippet:
  ```text
  - For company financial statements or metrics (revenue, net income, EPS, cash flows), call getFinancials. Provide ticker, timeframe (quarterly | annual | ttm), limit, and list the metrics you need (e.g., ["revenue","net_income","cash_from_operations"]).
  - After receiving data, format the table with filing period columns and metric columns. Include units in headers when appropriate.
  - If users request longer histories, make multiple calls with pagination or higher limit (up to 20 entries). Mention if older data is truncated.
  ```
- Mention that the assistant should combine financial outputs with other tools when relevant (e.g., price data + financial trends).

## Testing Strategy
- Extend `scripts/fetch_financials.py` or add tests for sample outputs verifying:
  - Quarterly and annual requests.
  - Metric filtering (e.g., `['revenue','net_income']`).
  - Handling >10 periods (pagination follow-up).
  - Error cases (invalid ticker, missing key).

## Future Enhancements
- Derived metrics: margins, FCF yield, YoY/ QoQ growth calculations within the tool for faster presentation.
- Integrate with charting pipeline to plot time series of fundamentals.
- Cache results server-side to reduce repeated Polygon calls during a conversation.

