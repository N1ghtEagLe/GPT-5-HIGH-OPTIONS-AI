import { z } from 'zod';
import type { ToolSpec } from '../llm/openai-runner.js';

const MAX_SERIES = 5;

const axisValueTypeSchema = z.enum(['datetime', 'category', 'numeric']);
const chartTypeSchema = z.enum(['line', 'bar']);
const lineStyleSchema = z.enum(['solid', 'dashed', 'dotted']);

const styleSchema = z.object({
  color: z.string().trim().min(1).optional(),
  lineStyle: lineStyleSchema.optional(),
  barWidth: z.number().positive().optional(),
}).partial();

const dataPointSchema = z.union([z.number(), z.string(), z.null()]);

const seriesSchema = z.object({
  name: z.string().trim().min(1),
  axis: z.enum(['left', 'right']).default('left'),
  data: z.array(dataPointSchema),
  style: styleSchema.optional(),
});

const axisLabelSchema = z.object({
  label: z.string().trim().max(120).optional(),
  unit: z.string().trim().max(32).optional(),
});

const strikeArrangementSchema = z.object({
  kind: z.literal('strike'),
  optionOrientation: z.enum(['calls-otm-right', 'puts-otm-right']),
});

const customArrangementSchema = z.object({
  kind: z.literal('custom'),
  sortOrder: z.enum(['asc', 'desc']),
});

const arrangementSchema = z
  .union([strikeArrangementSchema, customArrangementSchema, z.string()])
  .optional();

const chartInputSchema = z.object({
  title: z.string().trim().max(180).optional(),
  subtitle: z.string().trim().max(220).optional(),
  chartType: chartTypeSchema.default('line'),
  xAxis: z.object({
    label: z.string().trim().max(120).optional(),
    valueType: axisValueTypeSchema,
    values: z.array(z.union([z.string(), z.number()])).min(2),
    arrangement: arrangementSchema,
  }),
  series: z.array(seriesSchema).min(1).max(MAX_SERIES),
  yAxes: z
    .object({
      left: axisLabelSchema.optional(),
      right: axisLabelSchema.optional(),
    })
    .optional(),
  tooltip: z
    .object({
      precision: z.number().int().min(0).max(6).optional(),
    })
    .optional(),
});

type ChartInput = z.infer<typeof chartInputSchema>;
type NormalizedSeriesEntry = Omit<ChartInput['series'][number], 'data'> & {
  data: Array<number | null>;
};
type ChartExecutionInput = Omit<ChartInput, 'series'> & {
  series: NormalizedSeriesEntry[];
};
type StrikeArrangement = z.infer<typeof strikeArrangementSchema>;
type CustomArrangement = z.infer<typeof customArrangementSchema>;
type RecognizedArrangement = StrikeArrangement | CustomArrangement;

const normalizeArrangement = (
  input: ChartInput['xAxis']['arrangement']
): RecognizedArrangement | null => {
  if (!input) return null;

  if (typeof input === 'object') {
    const candidate = input as Record<string, unknown>;
    const kind = candidate.kind;
    if (kind === 'strike') {
      const orientation = candidate.optionOrientation;
      if (orientation === 'calls-otm-right' || orientation === 'puts-otm-right') {
        return { kind: 'strike', optionOrientation: orientation };
      }
      return null;
    }
    if (kind === 'custom') {
      const order = candidate.sortOrder;
      if (order === 'asc' || order === 'desc') {
        return { kind: 'custom', sortOrder: order };
      }
      return null;
    }
    return null;
  }

  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'calls-otm-right' || normalized === 'calls') {
      return { kind: 'strike', optionOrientation: 'calls-otm-right' };
    }
    if (normalized === 'puts-otm-right' || normalized === 'puts') {
      return { kind: 'strike', optionOrientation: 'puts-otm-right' };
    }
    if (normalized === 'asc' || normalized === 'ascending') {
      return { kind: 'custom', sortOrder: 'asc' };
    }
    if (normalized === 'desc' || normalized === 'descending') {
      return { kind: 'custom', sortOrder: 'desc' };
    }
    return null;
  }

  return null;
};

const buildAxisName = (axis?: { label?: string; unit?: string }) => {
  if (!axis) return undefined;
  if (axis.label && axis.unit) return `${axis.label} (${axis.unit})`;
  return axis.label ?? axis.unit ?? undefined;
};

const coerceNumeric = (value: number | string | null | undefined) => {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const sanitized = trimmed.replace(/[,\s]+/g, '');
  const parsed = parseFloat(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeSeriesData = (targetLength: number, raw: Array<number | string | null>) => {
  const normalized: Array<number | null> = raw.map(item => coerceNumeric(item));
  if (normalized.length > targetLength) {
    normalized.length = targetLength;
  }
  while (normalized.length < targetLength) {
    normalized.push(null);
  }
  return normalized;
};

const extractNumericValue = (input: string | number): number | null => {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  const trimmed = input.trim();
  if (!/^[$\d]/.test(trimmed)) return null;
  const sanitized = trimmed.replace(/,/g, '');
  const match = sanitized.match(/^\$?-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0].replace('$', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const toPairData = (xValues: Array<string | number>, data: Array<number | null>) =>
  xValues.map((x, idx) => {
    const y = data[idx];
    if (y === null || Number.isNaN(y)) return [x, null];
    return [x, y];
  });

const detectRightAxisUsage = (series: Array<{ axis: 'left' | 'right' }>) =>
  series.some(s => (s.axis ?? 'left') === 'right');

const computeXRange = (valueType: 'datetime' | 'category' | 'numeric', values: Array<string | number>) => {
  if (values.length === 0) return undefined;
  if (valueType === 'numeric') {
    const nums = values
      .map(v => (typeof v === 'number' ? v : Number(v)))
      .filter(v => Number.isFinite(v));
    if (nums.length === 0) return undefined;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }
  if (valueType === 'datetime') {
    const ms = values
      .map(v => (typeof v === 'number' ? v : Date.parse(String(v))))
      .filter(v => Number.isFinite(v));
    if (ms.length === 0) return undefined;
    return {
      min: new Date(Math.min(...ms)).toISOString(),
      max: new Date(Math.max(...ms)).toISOString(),
    };
  }
  return { min: values[0], max: values[values.length - 1] };
};

const toEChartsOption = (input: ChartExecutionInput) => {
  const { chartType, xAxis, series, yAxes, title, subtitle, tooltip } = input;
  const rightAxisUsed = detectRightAxisUsage(series);

  const xAxisOption: Record<string, unknown> = {
    type: xAxis.valueType === 'datetime' ? 'time' : xAxis.valueType === 'numeric' ? 'value' : 'category',
    name: xAxis.label,
    boundaryGap: chartType === 'bar',
    axisLine: { lineStyle: { color: '#adb5bd' } },
    axisLabel: { color: '#495057' },
    nameLocation: 'middle',
    nameGap: 36,
    nameTextStyle: {
      color: '#495057',
      fontSize: 12,
      padding: [6, 0, 0, 0],
    },
  };

  const yAxisOptionLeft: Record<string, unknown> = {
    type: 'value',
    position: 'left',
    name: buildAxisName(yAxes?.left),
    axisLabel: { color: '#495057' },
    axisLine: { lineStyle: { color: '#adb5bd' } },
    splitLine: { lineStyle: { type: 'dashed', opacity: 0.4 } },
    nameGap: 50,
    nameTextStyle: {
      color: '#495057',
      fontSize: 12,
      padding: [0, 0, 0, 0],
    },
  };

  const yAxisOptions: Array<Record<string, unknown>> = [yAxisOptionLeft];
  if (rightAxisUsed || yAxes?.right) {
    yAxisOptions.push({
      type: 'value',
      position: 'right',
      name: buildAxisName(yAxes?.right),
      axisLabel: { color: '#495057' },
      axisLine: { lineStyle: { color: '#adb5bd' } },
      splitLine: { show: false },
      nameGap: 50,
      nameTextStyle: {
        color: '#495057',
        fontSize: 12,
        padding: [0, 0, 0, 0],
      },
    });
  }

  const legendData = series.map(s => s.name);

  const tooltipOption: Record<string, unknown> = {
    trigger: 'axis',
    axisPointer: { type: chartType === 'bar' ? 'shadow' : 'cross' },
  };

  const legendOption: Record<string, unknown> = {
    data: legendData,
    icon: 'circle',
    bottom: 12,
    left: 'center',
    itemHeight: 10,
    itemWidth: 10,
    itemGap: 12,
    textStyle: {
      color: '#495057',
      fontSize: 12,
      padding: [4, 0, 0, 0],
    },
  };

  const palette = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444'];

  const seriesOptions = series.map((entry, idx) => {
    const pairData = toPairData(xAxis.values, entry.data);
    const base: Record<string, unknown> = {
      name: entry.name,
      type: chartType,
      yAxisIndex: entry.axis === 'right' ? 1 : 0,
      data: pairData,
      connectNulls: false,
      emphasis: { focus: 'series' },
    };

    if (chartType === 'line') {
      base.smooth = false;
      base.showSymbol = pairData.length <= 120;
      base.symbol = 'circle';
      base.symbolSize = 6;
      base.lineStyle = { width: 2, type: entry.style?.lineStyle ?? 'solid' };
    } else if (chartType === 'bar') {
      if (entry.style?.barWidth) base.barWidth = entry.style.barWidth;
    }

    const color = entry.style?.color ?? palette[idx % palette.length];
    base.itemStyle = { color };
    if (chartType === 'line') {
      base.lineStyle = { ...(base.lineStyle as Record<string, unknown>), color };
    }

    return base;
  });

  const option: Record<string, unknown> = {
    backgroundColor: 'transparent',
    animation: false,
    color: palette,
    tooltip: tooltipOption,
    legend: legendOption,
    grid: { left: 64, right: rightAxisUsed ? 80 : 40, top: 32, bottom: 84, containLabel: true },
    xAxis: xAxisOption,
    yAxis: yAxisOptions,
    series: seriesOptions,
  };

  return option;
};

const chartToolExecute: ToolSpec['execute'] = async (args: unknown) => {
  const parsed = chartInputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      error: true,
      message: 'Invalid chart payload',
      issues: parsed.error.flatten(),
    };
  }

  const payload = parsed.data;
  const normalizedSeries: NormalizedSeriesEntry[] = payload.series.map(series => ({
    ...series,
    data: normalizeSeriesData(payload.xAxis.values.length, series.data),
  }));

  const lengthsMismatch = normalizedSeries.some(s => s.data.length !== payload.xAxis.values.length);
  if (lengthsMismatch) {
    return {
      error: true,
      message: 'Each series must have the same length as the x-axis values',
    };
  }

  let adjustedXAxis = { ...payload.xAxis };
  let adjustedSeries: NormalizedSeriesEntry[] = normalizedSeries;

  const rawArrangement = payload.xAxis.arrangement;
  const arrangement = normalizeArrangement(rawArrangement);

  if (!arrangement && rawArrangement && typeof rawArrangement === 'object') {
    return {
      error: true,
      message: 'Invalid x-axis arrangement configuration',
    };
  }

  if (arrangement) {
    const sortedIndices = payload.xAxis.values.map((_, idx) => idx);

    if (arrangement.kind === 'strike') {
      const numericValues = payload.xAxis.values.map((raw, idx) =>
        extractNumericValue(typeof raw === 'number' ? raw : String(raw).trim())
      );

      if (numericValues.some(value => value === null)) {
        return {
          error: true,
          message: 'Strike arrangement requested but strike values could not be parsed as positive numbers',
        };
      }

      const desiredDirection = arrangement.optionOrientation === 'calls-otm-right' ? 'asc' : 'desc';
      sortedIndices.sort((a, b) =>
        desiredDirection === 'asc'
          ? (numericValues[a] as number) - (numericValues[b] as number)
          : (numericValues[b] as number) - (numericValues[a] as number)
      );

      adjustedXAxis = {
        ...adjustedXAxis,
        valueType: 'category',
        values: sortedIndices.map(i => payload.xAxis.values[i]),
      };
      adjustedSeries = adjustedSeries.map<NormalizedSeriesEntry>(entry => ({
        ...entry,
        data: sortedIndices.map(i => entry.data[i]),
      }));
    } else {
      const { sortOrder } = arrangement;
      const compareValues = (aIdx: number, bIdx: number) => {
        const aValue = payload.xAxis.values[aIdx];
        const bValue = payload.xAxis.values[bIdx];

        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
        }

        const aText = String(aValue);
        const bText = String(bValue);
        const comparison = aText.localeCompare(bText, undefined, { sensitivity: 'base', numeric: true });
        return sortOrder === 'asc' ? comparison : -comparison;
      };

      sortedIndices.sort(compareValues);
      adjustedXAxis = {
        ...adjustedXAxis,
        valueType: 'category',
        values: sortedIndices.map(i => payload.xAxis.values[i]),
      };
      adjustedSeries = adjustedSeries.map<NormalizedSeriesEntry>(entry => ({
        ...entry,
        data: sortedIndices.map(i => entry.data[i]),
      }));
    }
  }

  const option = toEChartsOption({ ...payload, xAxis: adjustedXAxis, series: adjustedSeries });
  const xRange = computeXRange(adjustedXAxis.valueType, adjustedXAxis.values);

  return {
    ok: true,
    chartType: payload.chartType,
    title: payload.title,
    subtitle: payload.subtitle,
    spec: option,
    axisMeta: {
      x: adjustedXAxis,
      y: payload.yAxes ?? {},
    },
    series: adjustedSeries.map(s => ({
      name: s.name,
      axis: s.axis,
    })),
    dataSummary: {
      pointCount: adjustedXAxis.values.length,
      seriesNames: adjustedSeries.map(s => s.name),
      xRange,
    },
    tooltip: payload.tooltip ?? {},
    source: {
      x: adjustedXAxis.values,
      series: adjustedSeries.map(s => ({ name: s.name, data: s.data })),
    },
    generatedAt: new Date().toISOString(),
  };
};

export const chartTools: Record<string, ToolSpec> = {
  renderChart: {
    description:
      'Render a chart from prepared data. Provide x-axis values plus one or more series and set chartType to "line" or "bar". Use after fetching data from Polygon tools.',
    parameters: chartInputSchema,
    execute: chartToolExecute,
  },
};
