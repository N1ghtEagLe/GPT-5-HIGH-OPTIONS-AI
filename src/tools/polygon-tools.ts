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
  },

  // New tool: Get daily OHLC data for multiple tickers asynchronously
  getMultipleDailyOpenClose: {
    description: 'Get daily open, close, high, and low prices for multiple stock tickers on a given date. Fetches all tickers in parallel for efficiency.',
    parameters: z.object({
      tickers: z.array(z.string()).describe('Array of stock ticker symbols (e.g., ["AAPL", "GOOGL", "TSLA"])'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in YYYY-MM-DD format'),
      adjusted: z.boolean().optional().describe('Whether to return adjusted prices for splits')
    }),
    execute: async ({ tickers, date, adjusted }: { tickers: string[]; date: string; adjusted?: boolean }) => {
      console.log(`\n🔍 Tool execution - getMultipleDailyOpenClose called with:`, { tickers, date, adjusted });
      
      // Initialize Polygon client
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
      console.log(`📊 Fetching data for ${tickers.length} tickers in parallel...`);
      
      // Create array of promises for parallel execution
      const promises = tickers.map(async (ticker) => {
        try {
          const response = await polygonClient.stocks.dailyOpenClose(ticker, date, { 
            adjusted: adjusted ? 'true' : 'false' 
          });
          
          console.log(`✅ Retrieved data for ${ticker}`);
          
          return {
            ticker: response.symbol || ticker,
            status: 'success',
            data: {
              date: date,
              open: response.open,
              high: response.high,
              low: response.low,
              close: response.close,
              volume: response.volume,
              afterHours: response.afterHours,
              preMarket: response.preMarket
            }
          };
        } catch (error: any) {
          console.error(`❌ Failed to fetch ${ticker}:`, error.message);
          
          return {
            ticker: ticker,
            status: 'error',
            error: error.message || 'Failed to fetch data',
            errorDetails: error.status === 'NOT_FOUND' ? 'Ticker not found or no data for this date' : error.message
          };
        }
      });
      
      // Execute all requests in parallel
      const results = await Promise.allSettled(promises);
      
      // Process results
      const processedResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            ticker: tickers[index],
            status: 'error',
            error: 'Request failed',
            errorDetails: result.reason
          };
        }
      });
      
      // Summary statistics
      const successful = processedResults.filter(r => r.status === 'success').length;
      const failed = processedResults.filter(r => r.status === 'error').length;
      
      console.log(`\n📊 Summary: ${successful} successful, ${failed} failed out of ${tickers.length} tickers`);
      
      return {
        date: date,
        requestedTickers: tickers,
        summary: {
          total: tickers.length,
          successful: successful,
          failed: failed
        },
        results: processedResults
      };
    }
  }
};

// Type exports for better TypeScript support
export type PolygonTools = typeof polygonTools; 