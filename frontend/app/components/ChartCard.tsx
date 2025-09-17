'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import * as echarts from 'echarts';
import { useTheme } from '../contexts/ThemeContext';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

export interface ChartMessageSeriesMeta {
  name: string;
  axis?: 'left' | 'right';
}

export interface ChartMessageAxisMeta {
  label?: string;
  unit?: string;
  valueType?: 'datetime' | 'category' | 'numeric';
  values?: Array<string | number>;
}

export interface ChartMessageChart {
  id: string;
  title?: string;
  subtitle?: string;
  chartType?: string;
  spec: Record<string, any>;
  dataSummary?: {
    pointCount: number;
    seriesNames: string[];
    xRange?: { min: string | number; max: string | number };
  };
  axisMeta?: {
    x?: ChartMessageAxisMeta;
    y?: {
      left?: ChartMessageAxisMeta;
      right?: ChartMessageAxisMeta;
    };
  };
  tooltip?: {
    precision?: number;
  };
  series?: ChartMessageSeriesMeta[];
  source?: {
    x: Array<string | number>;
    series: Array<{ name: string; data: Array<number | null> }>;
  };
  generatedAt?: string;
}

interface ChartCardProps {
  chart: ChartMessageChart;
}

const buildFormatter = (
  precision: number | undefined,
  seriesMeta: ChartMessageSeriesMeta[] | undefined,
  axisMeta: ChartMessageChart['axisMeta'] | undefined
) => {
  if (typeof precision !== 'number') return undefined;

  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  const seriesAxis = new Map<string, 'left' | 'right'>();
  seriesMeta?.forEach((meta) => {
    if (meta.name) seriesAxis.set(meta.name, meta.axis ?? 'left');
  });

  return (params: any) => {
    const items = Array.isArray(params) ? params : [params];
    if (items.length === 0) return '';

    const header = items[0]?.axisValueLabel ?? items[0]?.name ?? '';
    const lines = items.map((item: any) => {
      const seriesName = item?.seriesName ?? '';
      const valueArray = Array.isArray(item?.value) ? item.value : item?.data;
      const numericValue = Array.isArray(valueArray) ? valueArray[1] : valueArray;
      if (numericValue === null || typeof numericValue === 'undefined') {
        return `${seriesName}: n/a`;
      }
      const formattedValue = formatter.format(Number(numericValue));
      const axisSide = seriesAxis.get(seriesName) ?? 'left';
      const unit = axisSide === 'right' ? axisMeta?.y?.right?.unit : axisMeta?.y?.left?.unit;
      return unit ? `${seriesName}: ${formattedValue} ${unit}` : `${seriesName}: ${formattedValue}`;
    });

    return [header, ...lines].join('<br/>');
  };
};

export function ChartCard({ chart }: ChartCardProps) {
  const { isDarkMode } = useTheme();
  const palette = useMemo(() => {
    if (typeof window === 'undefined') {
      return Array.isArray(chart.spec?.color) && chart.spec?.color.length > 0
        ? chart.spec?.color
        : ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444'];
    }
    const style = getComputedStyle(document.documentElement);
    const colors: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const value = style.getPropertyValue(`--chart-series-${i}`).trim();
      if (value) colors.push(value);
    }
    if (colors.length === 0) {
      if (Array.isArray(chart.spec?.color) && chart.spec?.color.length > 0) return chart.spec?.color;
      return ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444'];
    }
    return colors;
  }, [chart.spec, chart.id, chart.generatedAt, isDarkMode]);

  const themeTextColors = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        primary: '#495057',
        secondary: '#6c757d',
        axis: '#495057',
      };
    }
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--text-primary').trim() || '#495057';
    const secondary = style.getPropertyValue('--text-secondary').trim() || '#6c757d';
    const axis = style.getPropertyValue('--border-primary').trim() || secondary || '#495057';
    return { primary, secondary, axis };
  }, [chart.id, chart.generatedAt, isDarkMode]);

  const option = useMemo(() => {
    if (!chart?.spec) return undefined;
    const clonedTooltip = { ...(chart.spec.tooltip ?? {}) };
    const formatter = buildFormatter(chart.tooltip?.precision, chart.series, chart.axisMeta);
    if (formatter) {
      clonedTooltip.formatter = formatter;
    }

    const tooltipTheme = isDarkMode
      ? {
          background: 'rgba(0, 0, 0, 0.5)',
          border: 'rgba(245, 158, 11, 0.8)',
          text: '#fbbf24',
        }
      : {
          background: 'rgba(255, 255, 255, 0.5)',
          border: 'rgba(37, 99, 235, 0.6)',
          text: '#1d4ed8',
        };

    clonedTooltip.backgroundColor = tooltipTheme.background;
    clonedTooltip.borderColor = tooltipTheme.border;
    clonedTooltip.borderWidth = typeof clonedTooltip.borderWidth === 'number' ? clonedTooltip.borderWidth : 1;
    clonedTooltip.textStyle = {
      ...(clonedTooltip.textStyle ?? {}),
      color: tooltipTheme.text,
      fontWeight: '600',
    };
    const cssExtras = clonedTooltip.extraCssText ? `${clonedTooltip.extraCssText};` : '';
    clonedTooltip.extraCssText = `${cssExtras}backdrop-filter: blur(6px);border-radius:8px;`.replace(';;', ';');

    const pointerColor = tooltipTheme.text;
    const pointer = clonedTooltip.axisPointer ?? {};
    if (pointer.type === 'cross') {
      pointer.lineStyle = { ...(pointer.lineStyle ?? {}), color: pointerColor, opacity: 0.7 };
      pointer.crossStyle = { ...(pointer.crossStyle ?? {}), color: pointerColor, opacity: 0.7 };
    } else if (pointer.type === 'shadow') {
      pointer.shadowStyle = { ...(pointer.shadowStyle ?? {}), color: tooltipTheme.background };
      pointer.lineStyle = { ...(pointer.lineStyle ?? {}), color: pointerColor, opacity: 0.4 };
    }
    clonedTooltip.axisPointer = pointer;

    const legend = chart.spec.legend
      ? Array.isArray(chart.spec.legend)
        ? chart.spec.legend.map(entry => ({
            ...entry,
            textStyle: {
              ...(entry.textStyle ?? {}),
              color: themeTextColors.secondary,
            },
          }))
        : {
            ...chart.spec.legend,
            textStyle: {
              ...(chart.spec.legend.textStyle ?? {}),
              color: themeTextColors.secondary,
            },
          }
      : undefined;

    const decorateAxis = (axis: any) => {
      const base = axis ?? {};
      const decorated = {
        ...base,
        axisLabel: {
          ...(base.axisLabel ?? {}),
          color: themeTextColors.secondary,
        },
        axisLine: {
          ...(base.axisLine ?? {}),
          lineStyle: {
            ...((base.axisLine && base.axisLine.lineStyle) || {}),
            color: themeTextColors.axis,
          },
        },
        nameTextStyle: {
          ...(base.nameTextStyle ?? {}),
          color: themeTextColors.secondary,
        },
      } as any;

      if (!isDarkMode) {
        const existing = base.splitLine ?? {};
        const existingLineStyle = existing.lineStyle ?? {};
        decorated.splitLine = {
          ...existing,
          lineStyle: {
            color: existingLineStyle.color ?? 'rgba(71, 85, 105, 0.65)',
            width: existingLineStyle.width ?? 1,
            type: existingLineStyle.type ?? 'dashed',
            opacity: existingLineStyle.opacity ?? 0.8,
          },
        };
      }

      return decorated;
    };

    const xAxis = Array.isArray(chart.spec.xAxis)
      ? chart.spec.xAxis.map(decorateAxis)
      : decorateAxis(chart.spec.xAxis);

    const yAxis = Array.isArray(chart.spec.yAxis)
      ? chart.spec.yAxis.map(decorateAxis)
      : decorateAxis(chart.spec.yAxis);

    const series = Array.isArray(chart.spec.series)
      ? chart.spec.series.map((entry: any, idx: number) => {
          const color = palette[idx % palette.length];
          const itemStyle = { ...(entry.itemStyle ?? {}), color };
          const lineStyle =
            entry.type === 'line'
              ? { ...(entry.lineStyle ?? {}), color }
              : entry.lineStyle;
          return {
            ...entry,
            itemStyle,
            lineStyle,
          };
        })
      : chart.spec.series;

    return {
      ...chart.spec,
      color: palette,
      legend,
      xAxis,
      yAxis,
      series,
      tooltip: { ...clonedTooltip },
    };
  }, [chart, palette, themeTextColors, isDarkMode]);

  const height = useMemo(() => {
    const seriesCount = Array.isArray(chart.spec?.series) ? chart.spec.series.length : 1;
    const base = seriesCount > 2 ? 360 + (seriesCount - 2) * 24 : 360;
    return Math.max(320, Math.min(base, 480));
  }, [chart.spec]);

  return (
    <div className="chart-card" aria-label={chart.title ?? 'Generated chart'}>
      {(chart.title || chart.subtitle) && (
        <div className="chart-card-header">
          {chart.title && <h3>{chart.title}</h3>}
          {chart.subtitle && <p>{chart.subtitle}</p>}
        </div>
      )}
      {option ? (
        <ReactECharts echarts={echarts} option={option} style={{ height }} notMerge lazyUpdate opts={{ renderer: 'canvas' }} />
      ) : (
        <div className="chart-card-empty">Chart configuration unavailable.</div>
      )}
      {chart.dataSummary && (
        <div className="chart-card-footer">
          <span>
            {chart.dataSummary.seriesNames.join(', ')} · {chart.dataSummary.pointCount} points
          </span>
          {chart.dataSummary.xRange && (
            <span>
              {typeof chart.dataSummary.xRange.min === 'string'
                ? chart.dataSummary.xRange.min
                : String(chart.dataSummary.xRange.min)}
              {' — '}
              {typeof chart.dataSummary.xRange.max === 'string'
                ? chart.dataSummary.xRange.max
                : String(chart.dataSummary.xRange.max)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default ChartCard;
