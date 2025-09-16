'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import * as echarts from 'echarts';

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
  const option = useMemo(() => {
    if (!chart?.spec) return undefined;
    const clonedTooltip = { ...(chart.spec.tooltip ?? {}) };
    const formatter = buildFormatter(chart.tooltip?.precision, chart.series, chart.axisMeta);
    if (formatter) {
      clonedTooltip.formatter = formatter;
    }

    return {
      ...chart.spec,
      tooltip: { ...clonedTooltip },
    };
  }, [chart]);

  const height = useMemo(() => {
    const seriesCount = Array.isArray(chart.spec?.series) ? chart.spec.series.length : 1;
    const base = seriesCount > 2 ? 320 + (seriesCount - 2) * 24 : 320;
    return Math.max(280, Math.min(base, 440));
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
