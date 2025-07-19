import { z } from 'zod';
import { restClient } from '@polygon.io/client-js';

// Get debug mode from environment or default to false
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Helper function for debug logging
const debugLog = (...args: any[]) => {
  if (DEBUG_MODE) console.log(...args);
};

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
      debugLog(`\n🔍 Tool execution - getDailyOpenClose called with:`, { ticker, date, adjusted });
      
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
  },

  // New tool: Get option pricing data
  getOptionPrice: {
    description: 'Get option pricing data including bid, ask, and last trade price for a specific option contract',
    parameters: z.object({
      underlyingTicker: z.string().describe('The underlying stock ticker symbol (e.g., AAPL for Apple)'),
      strike: z.number().describe('The strike price of the option'),
      expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The expiration date in YYYY-MM-DD format'),
      optionType: z.enum(['call', 'put']).describe('The type of option - either "call" or "put"')
    }),
    execute: async ({ underlyingTicker, strike, expirationDate, optionType }: { 
      underlyingTicker: string; 
      strike: number; 
      expirationDate: string; 
      optionType: 'call' | 'put' 
    }) => {
      debugLog(`\n🔍 Tool execution - getOptionPrice called with:`, { 
        underlyingTicker, strike, expirationDate, optionType 
      });
      
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
      
      try {
        // Step 1: Find the exact option contract ticker
        console.log('🔍 Looking up option contract...');
        const contractsResponse = await polygonClient.reference.optionsContracts({
          underlying_ticker: underlyingTicker,
          expiration_date: expirationDate,
          strike_price: strike,
          contract_type: optionType,
          limit: 1
        });
        
        // Check if we found any contracts
        if (!contractsResponse.results || contractsResponse.results.length === 0) {
          console.error('❌ No matching option contract found');
          return {
            error: true,
            message: 'No matching option contract found',
            details: `No ${optionType} option found for ${underlyingTicker} at strike ${strike} expiring ${expirationDate}`
          };
        }
        
        const optionTicker = contractsResponse.results[0].ticker;
        if (!optionTicker) {
          console.error('❌ Option ticker not found in response');
          return {
            error: true,
            message: 'Option ticker not found in response',
            details: 'The API returned a contract but without a ticker symbol'
          };
        }
        debugLog(`✅ Found option contract: ${optionTicker}`);
        
        // Step 2: Get the snapshot data for this option
        console.log('📊 Fetching option snapshot data...');
        const snapshot: any = await polygonClient.options.snapshotOptionContract(underlyingTicker, optionTicker);
        
        // DEBUG: Log the raw snapshot response
        debugLog('\n🔍 DEBUG - Raw snapshot response:');
        debugLog(JSON.stringify(snapshot, null, 2));
        
        // Step 3: Get the last trade separately for better reliability
        debugLog('\n📊 Fetching last trade data...');
        let lastTradeData: any = null;
        let lastTradePrice = 0;
        let lastTradeTime = null;
        
        try {
          lastTradeData = await polygonClient.stocks.lastTrade(optionTicker);
          
          // DEBUG: Log the raw last trade response
          debugLog('\n🔍 DEBUG - Raw last trade response:');
          debugLog(JSON.stringify(lastTradeData, null, 2));
          
          if (lastTradeData && lastTradeData.results && lastTradeData.results.p) {
            lastTradePrice = lastTradeData.results.p;
            lastTradeTime = lastTradeData.results.t ? 
              new Date(lastTradeData.results.t / 1000000).toISOString() : null;
            console.log(`✅ Last trade found: $${lastTradePrice} at ${lastTradeTime}`);
          } else {
            console.log('⚠️ No last trade data available from separate call');
          }
        } catch (tradeError) {
          console.log('⚠️ Could not fetch last trade:', tradeError);
        }
        
        // Extract pricing data from the results object
        const results = snapshot.results || {};
        const lastQuote = results.last_quote || {};
        const snapshotLastTrade = results.last_trade || {};
        const details = results.details || {};
        const greeks = results.greeks || {};
        
        // Get bid and ask from last_quote
        const bid = lastQuote.bid || 0;
        const ask = lastQuote.ask || 0;
        
        // Also check snapshot's last trade if separate call didn't work
        if (lastTradePrice === 0 && snapshotLastTrade.price) {
          lastTradePrice = snapshotLastTrade.price;
          lastTradeTime = snapshotLastTrade.sip_timestamp ? 
            new Date(snapshotLastTrade.sip_timestamp / 1000000).toISOString() : null;
          console.log(`✅ Using last trade from snapshot: $${lastTradePrice}`);
        }
        
        // Calculate mid price if bid and ask are available
        let midPrice = null;
        if (bid > 0 && ask > 0) {
          midPrice = (bid + ask) / 2;
        }
        
        console.log(`✅ Option pricing retrieved successfully`);
        
        const result = {
          optionTicker: optionTicker,
          underlyingTicker: underlyingTicker,
          strike: details.strike_price || strike,
          expirationDate: details.expiration_date || expirationDate,
          optionType: details.contract_type || optionType,
          pricing: {
            bid: bid,
            ask: ask,
            midPrice: midPrice,
            lastTrade: lastTradePrice,
            bidAskSpread: ask > 0 && bid > 0 ? ask - bid : null
          },
          volume: results.day?.volume || 0,
          openInterest: results.open_interest || 0,
          impliedVolatility: results.implied_volatility || null,
          greeks: {
            delta: greeks.delta || null,
            gamma: greeks.gamma || null,
            theta: greeks.theta || null,
            vega: greeks.vega || null
          },
          lastQuoteTime: lastQuote.last_updated ? new Date(lastQuote.last_updated / 1000000).toISOString() : null,
          lastTradeTime: lastTradeTime
        };
        
        debugLog(`📊 Option price result:`, result.pricing);
        return result;
        
      } catch (error) {
        console.error(`❌ Tool execution failed:`, error);
        
        // Handle and return any errors
        return {
          error: true,
          message: error instanceof Error ? error.message : 'Failed to fetch option pricing data',
          details: error
        };
      }
    }
  },

  // New tool: Get options chain filtered by moneyness for multiple tickers
  getOptionsChain: {
    description: 'Get option prices for multiple tickers filtered by moneyness percentage (e.g., 1-5% out of the money). Fetches current stock prices and returns only options within the specified moneyness range.',
    parameters: z.object({
      tickers: z.array(z.string()).describe('Array of underlying stock ticker symbols (e.g., ["AAPL", "TSLA"])'),
      expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The expiration date in YYYY-MM-DD format'),
      optionType: z.enum(['call', 'put']).describe('The type of option - either "call" or "put"'),
      moneynessRange: z.object({
        min: z.number().describe('Minimum moneyness percentage (e.g., 1 for 1% OTM)'),
        max: z.number().describe('Maximum moneyness percentage (e.g., 5 for 5% OTM)')
      }).describe('The moneyness range as percentages'),
      side: z.enum(['otm', 'itm']).describe('Whether to get out-of-the-money or in-the-money options')
    }),
    execute: async ({ tickers, expirationDate, optionType, moneynessRange, side }: {
      tickers: string[];
      expirationDate: string;
      optionType: 'call' | 'put';
      moneynessRange: { min: number; max: number };
      side: 'otm' | 'itm';
    }) => {
      console.log(`\n🔍 Tool execution - getOptionsChain called with:`, { 
        tickers, expirationDate, optionType, moneynessRange, side 
      });
      
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
      
      try {
        // Step 1: Get current prices for all tickers in parallel
        console.log('📊 Fetching current prices for all tickers...');
        const pricePromises = tickers.map(async (ticker) => {
          try {
            const quote = await polygonClient.stocks.lastQuote(ticker);
            const price = quote.results ? (quote.results.P || quote.results.p || 0) : 0; // P for ask, p for last
            console.log(`✅ ${ticker} current price: $${price}`);
            return { ticker, price, error: null };
          } catch (error) {
            console.error(`❌ Failed to get price for ${ticker}:`, error);
            return { ticker, price: 0, error: error instanceof Error ? error.message : 'Failed to fetch price' };
          }
        });
        
        const tickerPrices = await Promise.all(pricePromises);
        
        // Process each ticker
        const chainPromises = tickerPrices.map(async ({ ticker, price, error }) => {
          if (error || price === 0) {
            return {
              ticker,
              error: error || 'Could not fetch current price',
              contracts: []
            };
          }
          
          // Step 2: Calculate strike range based on moneyness
          let minStrike: number, maxStrike: number;
          
          if (optionType === 'call') {
            if (side === 'otm') {
              // OTM calls are above current price
              minStrike = price * (1 + moneynessRange.min / 100);
              maxStrike = price * (1 + moneynessRange.max / 100);
            } else {
              // ITM calls are below current price
              minStrike = price * (1 - moneynessRange.max / 100);
              maxStrike = price * (1 - moneynessRange.min / 100);
            }
          } else {
            // Put options
            if (side === 'otm') {
              // OTM puts are below current price
              minStrike = price * (1 - moneynessRange.max / 100);
              maxStrike = price * (1 - moneynessRange.min / 100);
            } else {
              // ITM puts are above current price
              minStrike = price * (1 + moneynessRange.min / 100);
              maxStrike = price * (1 + moneynessRange.max / 100);
            }
          }
          
          console.log(`📊 ${ticker} - Current: $${price}, Strike range: $${minStrike.toFixed(2)} - $${maxStrike.toFixed(2)}`);
          
          // Step 3: Get contracts within the strike range
          const contractsResponse = await polygonClient.reference.optionsContracts({
            underlying_ticker: ticker,
            expiration_date: expirationDate,
            contract_type: optionType,
            'strike_price.gte': minStrike,
            'strike_price.lte': maxStrike,
            limit: 100 // Reasonable limit for a moneyness range
          });
          
          if (!contractsResponse.results || contractsResponse.results.length === 0) {
            console.log(`⚠️ No contracts found for ${ticker} in the specified range`);
            return {
              ticker,
              currentPrice: price,
              strikeRange: { min: minStrike, max: maxStrike },
              contracts: []
            };
          }
          
          console.log(`✅ Found ${contractsResponse.results.length} contracts for ${ticker}`);
          
          // Step 4: Fetch pricing for all contracts in parallel
          const pricingPromises = contractsResponse.results.map(async (contract) => {
            try {
              if (!contract.ticker) {
                return {
                  ticker: 'Unknown',
                  strike: contract.strike_price,
                  error: 'Contract ticker not found'
                };
              }
              const snapshot: any = await polygonClient.options.snapshotOptionContract(ticker, contract.ticker);
              const results = snapshot.results || {};
              const lastQuote = results.last_quote || {};
              const lastTrade = results.last_trade || {};
              
              const bid = lastQuote.bid || 0;
              const ask = lastQuote.ask || 0;
              const lastTradePrice = lastTrade.price || 0;
              
              return {
                ticker: contract.ticker,
                strike: contract.strike_price,
                pricing: {
                  bid,
                  ask,
                  midPrice: bid > 0 && ask > 0 ? (bid + ask) / 2 : null,
                  lastTrade: lastTradePrice
                },
                volume: results.day?.volume || 0,
                openInterest: results.open_interest || 0,
                impliedVolatility: results.implied_volatility || null
              };
            } catch (error) {
              console.error(`❌ Failed to get pricing for ${contract.ticker}`);
              return {
                ticker: contract.ticker,
                strike: contract.strike_price,
                error: 'Failed to fetch pricing'
              };
            }
          });
          
          const contractPricing = await Promise.all(pricingPromises);
          
          // Sort by strike price
          contractPricing.sort((a, b) => (a.strike || 0) - (b.strike || 0));
          
          return {
            ticker,
            currentPrice: price,
            strikeRange: { min: minStrike, max: maxStrike },
            contracts: contractPricing
          };
        });
        
        const results = await Promise.all(chainPromises);
        
        console.log(`\n✅ Options chain retrieval complete`);
        
        return {
          expirationDate,
          optionType,
          moneynessRange,
          side,
          results
        };
        
      } catch (error) {
        console.error(`❌ Tool execution failed:`, error);
        
        return {
          error: true,
          message: error instanceof Error ? error.message : 'Failed to fetch options chain',
          details: error
        };
      }
    }
  }
};

// Type exports for better TypeScript support
export type PolygonTools = typeof polygonTools; 