import { z } from 'zod';
import { restClient } from '@polygon.io/client-js';

// Initialize Polygon client with API key from environment variable
const polygonClient = restClient(process.env.POLYGON_API_KEY);

// Tool definition for getting daily open, close, high, and low
export const polygonTools = {
  // Get daily OHLC (Open, High, Low, Close) data for a specific ticker and date
  getDailyOpenClose: {
    description: 'Get daily open, close, high, and low prices for a specific stock ticker on a given date',
    parameters: z.object({
      ticker: z.string().describe('The stock ticker symbol (e.g., AAPL, GOOGL, TSLA)'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in YYYY-MM-DD format'),
      adjusted: z.boolean().optional().describe('Whether to return adjusted prices for splits')
    }),
    execute: async ({ ticker, date, adjusted }: { ticker: string; date: string; adjusted?: boolean }) => {
      try {
        // Call Polygon API to get daily OHLC data
        const response = await polygonClient.stocks.dailyOpenClose(ticker, date, { 
          adjusted: adjusted ? 'true' : 'false' 
        });
        
        // Return the response data
        return {
          status: response.status,
          ticker: response.symbol,
          date: date,
          open: response.open,
          high: response.high,
          low: response.low,
          close: response.close,
          volume: response.volume,
          afterHours: response.afterHours,
          preMarket: response.preMarket
        };
      } catch (error) {
        // Handle and return any errors
        return {
          error: true,
          message: error instanceof Error ? error.message : 'Failed to fetch daily OHLC data',
          details: error
        };
      }
    }
  }
};

// Type exports for better TypeScript support
export type PolygonTools = typeof polygonTools; 