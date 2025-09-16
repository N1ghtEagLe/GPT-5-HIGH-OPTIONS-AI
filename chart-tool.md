# Chart Tool Integration Spec

## 1. Goal & Scope
- Deliver an interactive charting capability within the chat UI that renders market visuals generated from data the model already retrieved via existing Polygon tools.
- The assistant will call a new backend tool (`renderChart`) and pass in fully prepared data series plus chart configuration (chart type, axes, titles, styling hints).
- MVP: support line (default) and bar charts, single-panel layout, single or dual Y axes, and hover tooltips that expose the exact values for each point.
- Out of scope for this iteration: the chart tool fetching Polygon data itself, multi-panel overlays, expression DSL. These remain future enhancements.

## 2. User Experience
- Assistant responses can include both text and a rendered chart card that appears directly underneath the assistant bubble (outside the markdown body).
- Each chart card shows:
  - Chart canvas (web rendering) with tooltips, crosshair, pan/zoom disabled for MVP (optional toggle later).
  - Title/subtitle derived from payload if provided.
  - Download button (“PNG”) and data menu (“Copy CSV”) as stretch goals.
- Charts are also persisted as images in conversation state so subsequent prompts can reference them.

## 3. High-Level Architecture
1. **Model** gathers market data via existing Polygon tools, optionally performs calculations, and calls `renderChart` with the processed dataset plus chart config.
2. **Backend** registers `renderChart` alongside Polygon tools.
   - Validates payload (schema check, unit tests).
   - Uses a charting engine (server-side rendering with [Apache ECharts via `echarts`](https://github.com/apache/echarts) and `echarts-stat` or Vega-Lite + `vega-cli`) to produce:
     - Interactive spec JSON returned to the frontend.
     - Static PNG buffer for archival/reference (optional first iteration: skip PNG; rely on frontend rendering and produce a `dataPreview` array the model can embed in conversation).
   - Returns structured response: `spec`, `pngBase64` (optional), `dataSummary`, `meta` (series names, units, axis labels).
3. **Frontend** receives the enhanced tool output in the chat response, renders interactive chart using the spec (prefer Apache ECharts for rich tooltips & dual axes). PNG (if produced) is displayed as fallback for email/sharing.
4. **Conversation State** stores the chart PNG/spec to auto-attach to follow-up requests similar to image uploads.

## 4. Tool Contract (MVP)
`renderChart` accepts only model-provided data.

### 4.1 Input Schema (Zod outline)
```
{
  "title": string (optional),
  "subtitle": string (optional),
  "chartType": "line" | "bar" (default: "line"),
  "xAxis": {
    "label": string (optional),
    "valueType": "datetime" | "category" | "numeric",
    "values": Array<string | number>
  },
  "series": [
    {
      "name": string,
      "axis": "left" | "right" (default "left"),
      "data": Array<number | null>,
      "style": {
        "color": string (optional),
        "lineStyle": "solid" | "dashed" | "dotted" (line charts only),
        "barWidth": number (bar charts only)
      }
    }
  ],
  "yAxes": {
    "left": { "label": string (optional), "unit": string (optional) },
    "right": { "label": string (optional), "unit": string (optional) }
  },
  "tooltip": {
    "format": "auto" | "custom", (MVP: auto only)
    "precision": number (optional)
  }
}
```
Constraints:
- `xAxis.values.length` must match each `series.data.length`.
- Allow up to e.g. 5 series in MVP to limit payload size.
- Validate numeric entries; `null` values render gaps (line) or skipped bars.

### 4.2 Output Schema
```
{
  "spec": object,          // ECharts option JSON configured for the chart type
  "previewPng": string?,   // base64 PNG (optional for MVP)
  "dataSummary": {
    "pointCount": number,
    "seriesNames": string[],
    "xRange": { "min": string | number, "max": string | number }
  },
  "description": string?   // short text (model can quote)
}
```
- `spec` includes tooltip configuration (shared axis trigger, formatted strings).
- `previewPng` allows the model to “see” the rendered chart; if omitted, we keep a simplified table embed for the model.

## 5. Backend Implementation Plan
1. **Define Tool Schema**
   - Add `renderChart` export inside `src/tools/chart-tool.ts` with Zod validator.
   - Ensure schema rejects mismatched lengths and unsupported chart types.
2. **Rendering Engine**
   - Pick `echarts` + [`echarts-node-canvas`](https://www.npmjs.com/package/echarts-node-canvas) for server-side PNG rendering.
   - Generate ECharts option from input:
     - Map `chartType` to `series[].type` (line/bar).
     - Configure dual axes: create `yAxis` array with left/right entries and map `series[i].yAxisIndex` accordingly.
     - Use `xAxis.type` based on `valueType` and set `data`.
     - Tooltip: `trigger: 'axis'`, `valueFormatter` to respect precision, show series name, value, unit.
   - Render PNG (optional: guard behind env flag if heavy).
3. **Return Data**
   - Provide zipped `spec` and `previewPng` as base64.
   - Summarize metadata (ranges, names) for assistant to mention.
4. **Integration**
   - Import tool in `src/server.ts`, merge with `polygonTools` when calling `runChatWithTools`.
   - Update `runChatWithTools` to capture tool **outputs** (currently only logs args). Extend to log the structured output and include it in HTTP response: e.g. add `charts` array when tool name is `renderChart`.

## 6. Frontend Workstream
1. **State & Types**
   - Extend `Message` type to include `charts?: RenderedChart[]`, where each chart holds `spec`, `previewPng?`, `title`, ids.
   - Store `previewPng` in `sessionImages` to auto-include on next prompt.
2. **Rendering**
   - Create `<ChartCard>` component (using [`echarts-for-react`](https://github.com/hustcc/echarts-for-react) or dynamic `echarts` import) that:
     - Accepts the `spec` JSON and optional PNG fallback.
     - Sets consistent theme (colors, fonts) and responsive width.
     - Enables tooltips with shared crosshair.
   - Place ChartCard below assistant text bubble.
3. **Accessibility & UX**
   - Provide alt text (“Chart of {series} vs {x-axis}”).
   - Add skeleton loader while spec hydrates.
   - Ensure charts shrink gracefully on mobile (use `ResizeObserver`).

## 7. Prompt & LLM Updates
- Update system prompt instructions:
  - Introduce `renderChart` tool with usage guidelines.
  - Emphasize: “You must fetch data via Polygon tools first, transform as needed, then call `renderChart` with arrays. Default chart type is line; set `chartType` to `"bar"` or other supported types when needed. For dual axis, set each series’ `axis` property.”
  - Require assistant to mention when a chart is produced (e.g., “Chart: [Title]”).
- Provide example tool call in prompt to guide structure.

## 8. Error Handling & Validation
- Schema rejects invalid arrays, missing values, or unsupported chart types.
- Backend returns descriptive `error` object (e.g., `{ error: true, message: 'Series length mismatch' }`). Assistant must verbalize failure.
- For rendering errors, fall back to returning a simple table instruction to the model.

## 9. Testing Plan
- Unit tests for schema validation (happy paths, mismatched lengths, >5 series).
- Snapshot test for ECharts option structure (line vs bar; left/right axis config).
- Integration smoke test hitting `/api/chat` with mocked `renderChart` call to ensure response contains `charts` array and frontend handles it.
- Manual QA: render line chart, bar chart, dual axis, missing data points, large data sets (e.g., 500 points) to confirm performance and tooltip accuracy.

## 10. Future Enhancements
- Allow chart tool to fetch Polygon data directly with declarative requests and an expression DSL for derived metrics.
- Support additional chart types (candlestick, area, scatter with regression lines).
- Enable annotations (earnings markers, horizontal levels) and multi-panel dashboards (price + volume/RSI).
- Provide zoom/pan, brush selection, and data download buttons.
- Persist chart specs for reuse (“refresh this chart with latest data”).

## 11. Estimated Effort
- Backend tool & rendering: ~1.5–2 days (including PNG generation and tests).
- Frontend chart component & UI adjustments: ~1.5 days.
- Prompt updates and assistant behavior tuning: ~0.5 day.
- QA & polishing: ~0.5 day.

