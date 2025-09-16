import { z } from 'zod';

export const FINANCIAL_STATEMENTS = ['income_statement', 'balance_sheet', 'cash_flow_statement', 'comprehensive_income'] as const;
export type FinancialStatement = typeof FINANCIAL_STATEMENTS[number];

export interface FinancialMetricDefinition {
  statement: FinancialStatement;
  field: string;
  label: string;
  unitHint?: string;
}

export const FINANCIAL_METRICS: Record<string, FinancialMetricDefinition> = {
  revenue: {
    statement: 'income_statement',
    field: 'revenues',
    label: 'Revenue',
    unitHint: 'USD',
  },
  net_income: {
    statement: 'income_statement',
    field: 'net_income_loss',
    label: 'Net Income',
    unitHint: 'USD',
  },
  gross_profit: {
    statement: 'income_statement',
    field: 'gross_profit',
    label: 'Gross Profit',
    unitHint: 'USD',
  },
  operating_income: {
    statement: 'income_statement',
    field: 'operating_income_loss',
    label: 'Operating Income',
    unitHint: 'USD',
  },
  eps_basic: {
    statement: 'income_statement',
    field: 'basic_earnings_per_share',
    label: 'EPS (Basic)',
    unitHint: 'USD/sh',
  },
  eps_diluted: {
    statement: 'income_statement',
    field: 'diluted_earnings_per_share',
    label: 'EPS (Diluted)',
    unitHint: 'USD/sh',
  },
  shares_basic: {
    statement: 'income_statement',
    field: 'basic_average_shares',
    label: 'Avg Shares (Basic)',
    unitHint: 'shares',
  },
  shares_diluted: {
    statement: 'income_statement',
    field: 'diluted_average_shares',
    label: 'Avg Shares (Diluted)',
    unitHint: 'shares',
  },
  total_assets: {
    statement: 'balance_sheet',
    field: 'assets',
    label: 'Total Assets',
    unitHint: 'USD',
  },
  total_liabilities: {
    statement: 'balance_sheet',
    field: 'liabilities',
    label: 'Total Liabilities',
    unitHint: 'USD',
  },
  shareholders_equity: {
    statement: 'balance_sheet',
    field: 'equity',
    label: "Shareholders' Equity",
    unitHint: 'USD',
  },
  cash_and_equivalents: {
    statement: 'balance_sheet',
    field: 'cash',
    label: 'Cash & Equivalents',
    unitHint: 'USD',
  },
  current_assets: {
    statement: 'balance_sheet',
    field: 'current_assets',
    label: 'Current Assets',
    unitHint: 'USD',
  },
  current_liabilities: {
    statement: 'balance_sheet',
    field: 'current_liabilities',
    label: 'Current Liabilities',
    unitHint: 'USD',
  },
  operating_cash_flow: {
    statement: 'cash_flow_statement',
    field: 'net_cash_flow_from_operating_activities',
    label: 'Operating Cash Flow',
    unitHint: 'USD',
  },
  investing_cash_flow: {
    statement: 'cash_flow_statement',
    field: 'net_cash_flow_from_investing_activities',
    label: 'Investing Cash Flow',
    unitHint: 'USD',
  },
  financing_cash_flow: {
    statement: 'cash_flow_statement',
    field: 'net_cash_flow_from_financing_activities',
    label: 'Financing Cash Flow',
    unitHint: 'USD',
  },
  net_cash_flow: {
    statement: 'cash_flow_statement',
    field: 'net_cash_flow',
    label: 'Net Cash Flow',
    unitHint: 'USD',
  },
  comprehensive_income: {
    statement: 'comprehensive_income',
    field: 'comprehensive_income_loss',
    label: 'Comprehensive Income',
    unitHint: 'USD',
  },
};

export const financialMetricKeySchema = z.enum(Object.keys(FINANCIAL_METRICS) as [string, ...string[]]);
export type FinancialMetricKey = z.infer<typeof financialMetricKeySchema>;

export const financialStatementSchema = z.enum(FINANCIAL_STATEMENTS);
