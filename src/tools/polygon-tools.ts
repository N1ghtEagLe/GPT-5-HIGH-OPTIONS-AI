import { z } from 'zod';
import { restClient } from '@polygon.io/client-js';

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
      console.log(`\n🔍 Tool execution - getDailyOpenClose called with:`, { ticker, date, adjusted });
      
      // Initialize Polygon client inside execute to ensure env vars are loaded
      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) {
        console.error('❌ Polygon API key not found in environment variables');
        return {
          error: true,
          message: 'Polygon API key not configured',
          details: 'Please ensure POLYGON_API_KEY is set in your .env file'
        };
      }
      
      const polygonClient = restClient(apiKey);
      console.log('✅ Polygon client initialized with API key');
      
      try {
        // Call Polygon API to get daily OHLC data
        const response = await polygonClient.stocks.dailyOpenClose(ticker, date, { 
          adjusted: adjusted ? 'true' : 'false' 
        });
        
        console.log(`✅ Tool execution successful - Retrieved data for ${ticker}`);
        
        // Return the response data
        const result = {
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
        
        console.log(`📊 Tool result:`, result);
        return result;
      } catch (error) {
        console.error(`❌ Tool execution failed:`, error);
        
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