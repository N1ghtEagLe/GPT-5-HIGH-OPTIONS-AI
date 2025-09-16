# Feature Ideas

## Unified Charting Pipeline
- Create a single charting tool endpoint that accepts a `type` (e.g., `iv_by_expiry`, `delta_by_strike`, `surface_heatmap`) plus one or more named data series (`x`, `y`, optional `z`, labels) so the assistant can reuse any Polygon dataset it just pulled.
- Frontend listens for structured chart payloads in assistant replies (e.g., fenced JSON with a `chart` key) and renders them via a shared chart component (Chart.js/Vega-Lite) alongside the chat response.
- Support both direct Polygon time series (aggregates, IV term structure) and lightweight derived data (computed Greeks, ratios) before rendering, with sane limits on data volume to keep charts responsive.
- Allow optional annotations (earnings dates, key levels) so the assistant can overlay context when available without adding new chart types.
