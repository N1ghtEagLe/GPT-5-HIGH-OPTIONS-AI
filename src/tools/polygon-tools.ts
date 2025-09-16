import { z } from 'zod';
import { restClient } from '@polygon.io/client-js';
import {
  FINANCIAL_METRICS,
  FINANCIAL_STATEMENTS,
  financialStatementSchema,
  type FinancialMetricDefinition,
} from './helpers/financial-metrics.js';

// Get debug mode from environment or default to false
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Helper function for debug logging
const debugLog = (...args: any[]) => {
  if (DEBUG_MODE) console.log(...args);
};

const DEFAULT_FINANCIAL_METRICS = [
  'revenue',
  'net_income',
  'eps_diluted',
  'operating_income',
  'operating_cash_flow',
] as const satisfies Array<keyof typeof FINANCIAL_METRICS>;

const MAX_FINANCIAL_RECORDS = 20;

type MetricKey = keyof typeof FINANCIAL_METRICS;

interface MetricValue {
  label: string;
  unit: string | null;
  value: number | null;
  statement: string;
  field: string;
}

const normalizeMetricKey = (key: string) => key.trim().toLowerCase().replace(/[\s-]+/g, '_');

const parseCursorFromNextUrl = (nextUrl?: string | null) => {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get('cursor') || undefined;
  } catch (error) {
    debugLog('⚠️ Failed to parse next_url cursor', error);
    return undefined;
  }
};

const collectMetric = (definition: FinancialMetricDefinition, source: any): MetricValue => {
  const raw = source?.[definition.field] ?? {};
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label : definition.label;
  const value = raw && typeof raw.value === 'number' ? raw.value : null;
  const unit = typeof raw.unit === 'string' && raw.unit.trim().length > 0 ? raw.unit : definition.unitHint || null;
  return {
    label,
    unit,
    value,
    statement: definition.statement,
    field: definition.field,
  };
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
    description: 'Get option pricing data including bid, ask, and last trade price for a specific option contract. Use this ONLY for a single explicit contract. For multiple strikes, use the chain tools (they already include prices and greeks).',
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
        console.log(`🔍 Looking up ${underlyingTicker} $${strike} ${optionType} expiring ${expirationDate}...`);
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
        
        console.log(`✅ Retrieved pricing for ${optionTicker}\n`);
        debugLog(`✅ Option pricing retrieved successfully`);
        
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
    description: 'Get option prices for multiple tickers filtered by moneyness percentage (e.g., 1-5% out of the money). Fetches current stock prices and returns only options within the specified moneyness range. Returns bid/ask/mid/last, IV, OI, and Greeks (delta, gamma, theta, vega) per contract. Do NOT call getOptionPrice repeatedly for contracts returned by this tool — it already includes prices and greeks.',
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
      debugLog(`\n🔍 Tool execution - getOptionsChain called with:`, { 
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
      debugLog('✅ Polygon client initialized with API key');
      
      try {
        // Step 1: Get current prices for all tickers in parallel
        console.log('📊 Getting underlying prices...');
        debugLog('📊 Fetching current prices for all tickers...');
        const pricePromises = tickers.map(async (ticker) => {
          try {
            const quote = await polygonClient.stocks.lastQuote(ticker);
            const price = quote.results ? (quote.results.P || quote.results.p || 0) : 0; // P for ask, p for last
            debugLog(`✅ ${ticker} current price: $${price}`);
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
          
          debugLog(`📊 ${ticker} - Current: $${price}, Strike range: $${minStrike.toFixed(2)} - $${maxStrike.toFixed(2)}`);
          
          // Step 3: Get contracts within the strike range
          console.log(`🔍 Finding ${ticker} ${optionType} contracts in range...`);
          const contractsResponse = await polygonClient.reference.optionsContracts({
            underlying_ticker: ticker,
            expiration_date: expirationDate,
            contract_type: optionType,
            'strike_price.gte': minStrike,
            'strike_price.lte': maxStrike,
            limit: 100 // Reasonable limit for a moneyness range
          });
          
          if (!contractsResponse.results || contractsResponse.results.length === 0) {
            debugLog(`⚠️ No contracts found for ${ticker} in the specified range`);
            return {
              ticker,
              currentPrice: price,
              strikeRange: { min: minStrike, max: maxStrike },
              contracts: []
            };
          }
          
          debugLog(`✅ Found ${contractsResponse.results.length} contracts for ${ticker}`);
          console.log(`💰 Getting prices for ${contractsResponse.results.length} ${ticker} options...`);
          
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
              const greeks = results.greeks || {};
              
              const bid = lastQuote.bid || 0;
              const ask = lastQuote.ask || 0;
              const lastTradePrice = lastTrade.price || 0;
              
              // Calculate moneyness if we have current price
              let moneyness = null as number | null;
              if (price > 0 && contract.strike_price) {
                if (optionType === 'call') {
                  moneyness = ((contract.strike_price - price) / price) * 100;
                } else {
                  moneyness = ((price - contract.strike_price) / price) * 100;
                }
              }
              
              return {
                ticker: contract.ticker,
                strike: contract.strike_price,
                moneyness,
                pricing: {
                  bid,
                  ask,
                  midPrice: bid > 0 && ask > 0 ? (bid + ask) / 2 : null,
                  lastTrade: lastTradePrice
                },
                volume: results.day?.volume || 0,
                openInterest: results.open_interest || 0,
                impliedVolatility: results.implied_volatility || null,
                greeks: {
                  delta: greeks.delta || null,
                  gamma: greeks.gamma || null,
                  theta: greeks.theta || null,
                  vega: greeks.vega || null
                }
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
        
        console.log('✅ Option chain data retrieved successfully\n');
        debugLog(`\n✅ Options chain retrieval complete`);
        
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
  },

  // New tool: Get options chain filtered by absolute strike price range
  getOptionsChainByStrikes: {
    description: 'Get option prices filtered by absolute strike price range (e.g., all strikes between $170-$200). Use this when specific strike prices are requested, not percentages. Returns bid/ask/mid/last, IV, OI, and Greeks (delta, gamma, theta, vega) per contract. Do NOT call getOptionPrice repeatedly for contracts returned by this tool — it already includes prices and greeks.',
    parameters: z.object({
      tickers: z.array(z.string()).describe('Array of underlying stock ticker symbols (e.g., ["AAPL", "NVDA"])'),
      expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The expiration date in YYYY-MM-DD format'),
      optionType: z.enum(['call', 'put']).describe('The type of option - either "call" or "put"'),
      strikeRange: z.object({
        min: z.number().describe('Minimum strike price (e.g., 170)'),
        max: z.number().describe('Maximum strike price (e.g., 200)')
      }).describe('The absolute strike price range')
    }),
    execute: async ({ tickers, expirationDate, optionType, strikeRange }: {
      tickers: string[];
      expirationDate: string;
      optionType: 'call' | 'put';
      strikeRange: { min: number; max: number };
    }) => {
      debugLog(`\n🔍 Tool execution - getOptionsChainByStrikes called with:`, { 
        tickers, expirationDate, optionType, strikeRange 
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
      debugLog('✅ Polygon client initialized with API key');
      
      try {
        // Step 1: Get current prices for context (helps with % OTM calculation)
        console.log('📊 Getting current stock prices...');
        debugLog('📊 Fetching current prices for context...');
        const pricePromises = tickers.map(async (ticker) => {
          try {
            const quote = await polygonClient.stocks.lastQuote(ticker);
            const price = quote.results ? (quote.results.P || quote.results.p || 0) : 0;
            debugLog(`✅ ${ticker} current price: $${price}`);
            return { ticker, price };
          } catch (error) {
            console.error(`⚠️ Could not get current price for ${ticker}`);
            return { ticker, price: 0 };
          }
        });
        
        const tickerPrices = await Promise.all(pricePromises);
        const priceMap = new Map(tickerPrices.map(({ ticker, price }) => [ticker, price]));
        
        // Step 2: Process each ticker
        const chainPromises = tickers.map(async (ticker) => {
          const currentPrice = priceMap.get(ticker) || 0;
          
          debugLog(`📊 ${ticker} - Fetching contracts with strikes $${strikeRange.min} - $${strikeRange.max}`);
          
          // Get contracts within the absolute strike range
          console.log(`🔍 Finding ${ticker} options between $${strikeRange.min}-$${strikeRange.max}...`);
          const contractsResponse = await polygonClient.reference.optionsContracts({
            underlying_ticker: ticker,
            expiration_date: expirationDate,
            contract_type: optionType,
            'strike_price.gte': strikeRange.min,
            'strike_price.lte': strikeRange.max,
            limit: 250 // Higher limit since absolute ranges can be wide
          });
          
          if (!contractsResponse.results || contractsResponse.results.length === 0) {
            debugLog(`⚠️ No contracts found for ${ticker} in the specified range`);
            return {
              ticker,
              currentPrice,
              strikeRange,
              contracts: []
            };
          }
          
          debugLog(`✅ Found ${contractsResponse.results.length} contracts for ${ticker}`);
          console.log(`💰 Fetching prices for ${contractsResponse.results.length} ${ticker} contracts...`);
          
          // Step 3: Fetch pricing for all contracts in parallel
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
              const greeks = results.greeks || {};
              
              const bid = lastQuote.bid || 0;
              const ask = lastQuote.ask || 0;
              const lastTradePrice = lastTrade.price || 0;
              
              // Calculate moneyness if we have current price
              let moneyness = null;
              if (currentPrice > 0 && contract.strike_price) {
                if (optionType === 'call') {
                  moneyness = ((contract.strike_price - currentPrice) / currentPrice) * 100;
                } else {
                  moneyness = ((currentPrice - contract.strike_price) / currentPrice) * 100;
                }
              }
              
              return {
                ticker: contract.ticker,
                strike: contract.strike_price,
                moneyness, // This will show how far OTM/ITM each strike is
                pricing: {
                  bid,
                  ask,
                  midPrice: bid > 0 && ask > 0 ? (bid + ask) / 2 : null,
                  lastTrade: lastTradePrice
                },
                volume: results.day?.volume || 0,
                openInterest: results.open_interest || 0,
                impliedVolatility: results.implied_volatility || null,
                greeks: {
                  delta: greeks.delta || null,
                  gamma: greeks.gamma || null,
                  theta: greeks.theta || null,
                  vega: greeks.vega || null
                }
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
            currentPrice,
            strikeRange,
            contracts: contractPricing
          };
        });
        
        const results = await Promise.all(chainPromises);
        
        console.log('✅ Option data retrieved successfully\n');
        debugLog(`\n✅ Options chain by strikes retrieval complete`);
        
        return {
          expirationDate,
          optionType,
          strikeRange,
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
  },

  // Company financial statements and metrics
  getFinancials: {
    description: [
      'Retrieve standardized financial statement data (income, balance sheet, cash flow, comprehensive income) for a company. Supports quarterly, annual, or TTM filings and optional metric filtering.',
      'Recognized metric keys (use in the "metrics" array):',
      Object.entries(FINANCIAL_METRICS)
        .map(([key, def]) => `• ${key} (${def.statement} → ${def.field} — ${def.label})`)
        .join('\n'),
      'If a user asks which line items are available, list these keys (and mention the statement they map to).',
      'To retrieve full statements, pass the desired statement names via "statements" (e.g., ["income_statement"]).',
    ].join('\n'),
    parameters: z.object({
      ticker: z.string().min(1).describe('The stock ticker symbol (e.g., MSFT)'),
      timeframe: z.enum(['quarterly', 'annual', 'ttm']).optional().describe('Statement timeframe. Defaults to quarterly.'),
      limit: z.number().int().min(1).max(100).optional().describe('Number of filings to return (max 100 per Polygon request; tool caps at 20).'),
      sort: z.string().optional().describe('Polygon sort field (default period_of_report_date).'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort order (default desc).'),
      metrics: z.array(z.string()).optional().describe('Specific metric identifiers to return (e.g., ["revenue","net_income","eps_diluted"]).'),
      statements: z.array(financialStatementSchema).optional().describe('Statements to include in full form (income_statement, balance_sheet, cash_flow_statement, comprehensive_income).'),
      reportType: z.string().optional().describe('Filter by SEC report type (e.g., 10-Q, 10-K).'),
      fiscalPeriod: z.string().optional().describe('Filter by fiscal period (e.g., Q1, Q4, FY).'),
      fiscalYear: z.union([z.string(), z.number()]).optional().describe('Filter by fiscal year (e.g., 2024).'),
      filingDateGte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Earliest filing date (YYYY-MM-DD).'),
      filingDateLte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Latest filing date (YYYY-MM-DD).'),
      periodOfReportDateGte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Earliest period of report date (YYYY-MM-DD).'),
      periodOfReportDateLte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Latest period of report date (YYYY-MM-DD).'),
    }),
    execute: async ({
      ticker,
      timeframe,
      limit,
      sort,
      order,
      metrics,
      statements,
      reportType,
      fiscalPeriod,
      fiscalYear,
      filingDateGte,
      filingDateLte,
      periodOfReportDateGte,
      periodOfReportDateLte,
    }: {
      ticker: string;
      timeframe?: 'quarterly' | 'annual' | 'ttm';
      limit?: number;
      sort?: string;
      order?: 'asc' | 'desc';
      metrics?: string[];
      statements?: Array<typeof FINANCIAL_STATEMENTS[number]>;
      reportType?: string;
      fiscalPeriod?: string;
      fiscalYear?: string | number;
      filingDateGte?: string;
      filingDateLte?: string;
      periodOfReportDateGte?: string;
      periodOfReportDateLte?: string;
    }) => {
      console.log(`\n🔍 Tool execution - getFinancials called with:`, {
        ticker,
        timeframe,
        limit,
        metrics,
        statements,
        reportType,
        fiscalPeriod,
        fiscalYear,
      });

      const apiKey = process.env.POLYGON_API_KEY;
      if (!apiKey) {
        console.error('❌ Polygon API key not found in environment variables');
        return {
          error: true,
          message: 'Polygon API key not configured',
          details: 'Please ensure POLYGON_API_KEY is set in your .env file',
        };
      }

      const polygonClient = restClient(apiKey);
      debugLog('✅ Polygon client initialized with API key');

      const requestedLimit = Math.min(Math.max(limit ?? 4, 1), MAX_FINANCIAL_RECORDS);
      const baseQuery: Record<string, string> = {
        ticker,
        limit: String(Math.min(requestedLimit, 100)),
        sort: sort || 'period_of_report_date',
        order: order || 'desc',
      };
      if (timeframe) baseQuery.timeframe = timeframe;
      if (reportType) baseQuery.report_type = reportType;
      if (fiscalPeriod) baseQuery.fiscal_period = fiscalPeriod;
      if (typeof fiscalYear !== 'undefined') baseQuery.fiscal_year = String(fiscalYear);
      if (filingDateGte) baseQuery['filing_date.gte'] = filingDateGte;
      if (filingDateLte) baseQuery['filing_date.lte'] = filingDateLte;
      if (periodOfReportDateGte) baseQuery['period_of_report_date.gte'] = periodOfReportDateGte;
      if (periodOfReportDateLte) baseQuery['period_of_report_date.lte'] = periodOfReportDateLte;

      const metricPairs = Array.isArray(metrics)
        ? metrics
            .map((key) => ({ raw: String(key), normalized: normalizeMetricKey(String(key)) }))
            .filter((item) => item.normalized.length > 0)
        : [];
      const seenMetricKeys = new Set<string>();
      const resolvedMetricKeys: MetricKey[] = [];
      const unrecognizedMetrics: string[] = [];
      for (const { raw, normalized } of metricPairs) {
        if (seenMetricKeys.has(normalized)) continue;
        seenMetricKeys.add(normalized);
        if (FINANCIAL_METRICS[normalized as MetricKey]) {
          resolvedMetricKeys.push(normalized as MetricKey);
        } else {
          unrecognizedMetrics.push(raw);
        }
      }

      const statementFilter = Array.isArray(statements)
        ? statements.filter((statement): statement is typeof FINANCIAL_STATEMENTS[number] =>
            FINANCIAL_STATEMENTS.includes(statement)
          )
        : [];

      const filings: any[] = [];
      let cursor: string | undefined;
      let fetchGuard = 0;

      try {
        while (filings.length < requestedLimit && fetchGuard < 10) {
          const query = { ...baseQuery };
          query.limit = String(Math.min(requestedLimit - filings.length, requestedLimit, 100));
          if (cursor) {
            query.cursor = cursor;
          }

          debugLog('📡 Fetching financials batch with query:', query);
          const response: any = await polygonClient.reference.stockFinancials(query);
          const batch = Array.isArray(response?.results) ? response.results : [];
          filings.push(...batch);
          if (!response?.next_url || filings.length >= requestedLimit) {
            break;
          }
          cursor = parseCursorFromNextUrl(response.next_url);
          if (!cursor) break;
          fetchGuard += 1;
        }
      } catch (error: any) {
        console.error('❌ Failed to fetch financials:', error?.message || error);
        return {
          error: true,
          message: error?.message || 'Failed to fetch financials',
          details: error,
        };
      }

      const limitedResults = filings.slice(0, requestedLimit);

      const usingDefaultMetrics = resolvedMetricKeys.length === 0 && (!metrics || metrics.length === 0);
      const effectiveMetricKeys: MetricKey[] = resolvedMetricKeys.length > 0
        ? resolvedMetricKeys
        : usingDefaultMetrics
          ? [...DEFAULT_FINANCIAL_METRICS]
          : [];

      const normalizedFilings = limitedResults.map((entry) => {
        const financials = entry?.financials || {};
        const metricData: Record<string, MetricValue> = {};

        for (const metricKey of effectiveMetricKeys) {
          const definition = FINANCIAL_METRICS[metricKey];
          const statementData = financials?.[definition.statement] || {};
          metricData[metricKey] = collectMetric(definition, statementData);
        }

        const statementDataOutput: Record<string, Record<string, MetricValue>> = {};
        if (statementFilter.length > 0) {
          for (const statementKey of statementFilter) {
            const statementSource = financials?.[statementKey];
            if (!statementSource || typeof statementSource !== 'object') continue;
            const rows: Record<string, MetricValue> = {};
            for (const fieldKey of Object.keys(statementSource)) {
              const rowSource = statementSource[fieldKey];
              const label =
                rowSource && typeof rowSource.label === 'string' && rowSource.label.trim().length > 0
                  ? rowSource.label
                  : fieldKey;
              const unit =
                rowSource && typeof rowSource.unit === 'string' && rowSource.unit.trim().length > 0
                  ? rowSource.unit
                  : null;
              const value = rowSource && typeof rowSource.value === 'number' ? rowSource.value : null;
              rows[fieldKey] = {
                label,
                unit,
                value,
                statement: statementKey,
                field: fieldKey,
              };
            }
            if (Object.keys(rows).length > 0) {
              statementDataOutput[statementKey] = rows;
            }
          }
        }

        return {
          ticker: Array.isArray(entry?.tickers) && entry.tickers.length > 0 ? entry.tickers[0] : ticker,
          companyName: entry?.company_name || null,
          filingDate: entry?.filing_date || null,
          acceptanceDateTime: entry?.acceptance_datetime || null,
          startDate: entry?.start_date || null,
          endDate: entry?.end_date || null,
          periodOfReportDate: entry?.period_of_report_date || null,
          fiscalPeriod: entry?.fiscal_period || null,
          fiscalYear: entry?.fiscal_year || null,
          timeframe: entry?.timeframe || timeframe || null,
          reportType: entry?.report_type || null,
          sic: entry?.sic || null,
          metrics: metricData,
          statements: Object.keys(statementDataOutput).length > 0 ? statementDataOutput : undefined,
        };
      });

      return {
        ticker,
        timeframe: timeframe || null,
        limit: requestedLimit,
        metrics: effectiveMetricKeys,
        usedDefaultMetrics: usingDefaultMetrics,
        statements: statementFilter,
        unrecognizedMetrics,
        results: normalizedFilings,
      };
    },
  },

  // New tool: Get historical aggregates (aggs) between two times
  getAggregates: {
    description: 'Get historical aggregate bars for a stock ticker between two times. Supports minute/hour/day bars via multiplier and timespan.',
    parameters: z.object({
      ticker: z.string().describe('The stock ticker symbol (e.g., AAPL, SPY)'),
      multiplier: z.number().int().min(1).describe('The size of the timespan multiplier (e.g., 1, 5, 15)'),
      timespan: z.enum(['minute', 'hour', 'day']).describe('Aggregation timespan'),
      from: z.string().describe('Start time in YYYY-MM-DD or ISO 8601'),
      to: z.string().describe('End time in YYYY-MM-DD or ISO 8601'),
      adjusted: z.boolean().optional().describe('Return adjusted data (splits/dividends) if true'),
      sort: z.enum(['asc', 'desc']).optional().describe('Sort order of results'),
      limit: z.number().int().min(1).max(50000).optional().describe('Maximum number of bars to return')
    }),
    execute: async ({
      ticker,
      multiplier,
      timespan,
      from,
      to,
      adjusted,
      sort,
      limit
    }: {
      ticker: string;
      multiplier: number;
      timespan: 'minute' | 'hour' | 'day';
      from: string;
      to: string;
      adjusted?: boolean;
      sort?: 'asc' | 'desc';
      limit?: number;
    }) => {
      debugLog(`\n🔍 Tool execution - getAggregates called with:`, { ticker, multiplier, timespan, from, to, adjusted, sort, limit });

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
      debugLog('✅ Polygon client initialized with API key');

      try {
        const query: any = {
          adjusted: adjusted ? 'true' : 'false'
        };
        if (typeof sort === 'string') query.sort = sort;
        if (typeof limit === 'number') query.limit = String(limit);

        console.log(`📊 Fetching aggregates for ${ticker} ${multiplier}-${timespan} from ${from} to ${to}...`);
        const response: any = await polygonClient.stocks.aggregates(
          ticker,
          multiplier,
          timespan,
          from,
          to,
          query
        );

        const results = Array.isArray(response.results) ? response.results : [];

        const normalized = results.map((bar: any) => {
          const timestampMs: number = typeof bar.t === 'number' ? bar.t : Number(bar.t) || 0;
          const isoTime = timestampMs > 0 ? new Date(timestampMs).toISOString() : null;
          return {
            timestamp: isoTime,
            open: bar.o ?? null,
            high: bar.h ?? null,
            low: bar.l ?? null,
            close: bar.c ?? null,
            volume: bar.v ?? null,
            vwap: bar.vw ?? null,
            transactions: bar.n ?? null
          };
        });

        console.log(`✅ Retrieved ${normalized.length} bars for ${ticker}`);
        return {
          ticker,
          multiplier,
          timespan,
          from,
          to,
          adjusted: !!adjusted,
          sort: sort || 'asc',
          count: normalized.length,
          bars: normalized
        };
      } catch (error: any) {
        console.error('❌ Tool execution failed:', error?.message || error);
        return {
          error: true,
          message: error?.message || 'Failed to fetch aggregates',
          details: error
        };
      }
    }
  },

  // New tool: Get last trade price (real-time)
  getLastTrade: {
    description: 'Get the most recent trade price for a stock ticker. Returns real-time data including pre-market and after-hours trades.',
    parameters: z.object({
      ticker: z.string().describe('The stock ticker symbol (e.g., AAPL, SPY, TSLA)')
    }),
    execute: async ({ ticker }: { ticker: string }) => {
      debugLog(`\n🔍 Tool execution - getLastTrade called with:`, { ticker });
      
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
        console.log(`📊 Fetching last trade for ${ticker}...`);
        
        // Get the last trade
        const response = await polygonClient.stocks.lastTrade(ticker);
        
        if (!response || !response.results) {
          console.error('❌ No trade data returned');
          return {
            error: true,
            message: 'No trade data available',
            details: `No recent trades found for ${ticker}`
          };
        }
        
        const trade = response.results;
        
        // Convert timestamp from nanoseconds to readable format
        const timestamp = Number(trade.t) || Date.now() * 1000000;
        const tradeTime = new Date(timestamp / 1000000);
        const easternTime = tradeTime.toLocaleString('en-US', { 
          timeZone: 'America/New_York',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
        
        // Determine market session
        const hour = tradeTime.getHours();
        const minutes = tradeTime.getMinutes();
        const totalMinutes = hour * 60 + minutes;
        
        let session = 'Regular';
        if (totalMinutes < 570) { // Before 9:30 AM
          session = 'Pre-market';
        } else if (totalMinutes >= 960) { // After 4:00 PM
          session = 'After-hours';
        }
        
        console.log(`✅ Retrieved last trade for ${ticker}: $${trade.p}`);
        
        const result = {
          ticker: ticker,
          price: trade.p,
          size: trade.s,
          timestamp: tradeTime.toISOString(),
          easternTime: easternTime,
          session: session,
          exchange: trade.x,
          conditions: trade.c
        };
        
        debugLog(`📊 Last trade result:`, result);
        return result;
        
      } catch (error) {
        console.error(`❌ Tool execution failed:`, error);
        
        return {
          error: true,
          message: error instanceof Error ? error.message : 'Failed to fetch last trade',
          details: error
        };
      }
    }
  },

  // New tool: Get last trade for multiple tickers asynchronously
  getMultipleLastTrades: {
    description: 'Get the most recent trade prices for multiple stock tickers in parallel. Returns real-time data including pre-market and after-hours trades for all requested tickers.',
    parameters: z.object({
      tickers: z.array(z.string()).describe('Array of stock ticker symbols (e.g., ["AAPL", "GOOGL", "TSLA"])')
    }),
    execute: async ({ tickers }: { tickers: string[] }) => {
      console.log(`\n🔍 Tool execution - getMultipleLastTrades called with:`, { tickers });
      
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
      console.log(`📊 Fetching last trades for ${tickers.length} tickers in parallel...`);
      
      // Create array of promises for parallel execution
      const promises = tickers.map(async (ticker) => {
        try {
          const response = await polygonClient.stocks.lastTrade(ticker);
          
          if (!response || !response.results) {
            console.error(`❌ No trade data for ${ticker}`);
            return {
              ticker: ticker,
              status: 'error',
              error: 'No trade data available'
            };
          }
          
          const trade = response.results;
          
          // Convert timestamp from nanoseconds to readable format
          const timestamp = Number(trade.t) || Date.now() * 1000000;
          const tradeTime = new Date(timestamp / 1000000);
          const easternTime = tradeTime.toLocaleString('en-US', { 
            timeZone: 'America/New_York',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          });
          
          // Determine market session
          const hour = tradeTime.getHours();
          const minutes = tradeTime.getMinutes();
          const totalMinutes = hour * 60 + minutes;
          
          let session = 'Regular';
          if (totalMinutes < 570) { // Before 9:30 AM
            session = 'Pre-market';
          } else if (totalMinutes >= 960) { // After 4:00 PM
            session = 'After-hours';
          }
          
          console.log(`✅ Retrieved last trade for ${ticker}: $${trade.p}`);
          
          return {
            ticker: ticker,
            status: 'success',
            data: {
              price: trade.p,
              size: trade.s,
              timestamp: tradeTime.toISOString(),
              easternTime: easternTime,
              session: session,
              exchange: trade.x,
              conditions: trade.c
            }
          };
        } catch (error: any) {
          console.error(`❌ Failed to fetch ${ticker}:`, error.message);
          
          return {
            ticker: ticker,
            status: 'error',
            error: error.message || 'Failed to fetch last trade',
            errorDetails: error.status === 'NOT_FOUND' ? 'Ticker not found' : error.message
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
