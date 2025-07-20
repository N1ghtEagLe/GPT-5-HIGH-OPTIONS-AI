import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import dotenv from 'dotenv';
import { polygonTools } from './tools/polygon-tools.js';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Get the PIN from environment variable
const ENTRY_PIN = process.env.ENTRY_PIN || '12345678';

// Middleware
app.use(cors({
  origin: [
    'https://optionschat.io',
    'https://www.optionschat.io', 
    'https://options-gpt-chat-prod.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authentication endpoint
app.post('/api/auth', (req, res) => {
  const { pin } = req.body;
  
  
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }
  
  if (pin === ENTRY_PIN) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

// Main chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    // Extract message, conversation history, and PIN from request
    const { message, conversationHistory = [], pin } = req.body;
    
    // Verify PIN for each request (security measure)
    if (pin !== ENTRY_PIN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check for API keys
    const openAIKey = process.env.OPENAI_API_KEY;
    const polygonKey = process.env.POLYGON_API_KEY;
    
    if (!openAIKey || openAIKey === 'your-api-key-here') {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }
    
    if (!polygonKey || polygonKey === 'your-polygon-api-key-here') {
      return res.status(500).json({ error: 'Polygon API key not configured' });
    }

    // Get current date and time in Eastern Time
    const now = new Date();
    const easternTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(now);
    
    // Determine market status
    const easternHour = parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false
    }).format(now));
    const dayOfWeek = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
    const isWeekday = !['Sat', 'Sun'].includes(dayOfWeek);
    const marketStatus = isWeekday && easternHour >= 9.5 && easternHour < 16 ? 'Open' : 'Closed';
    
    // System message with current context
    const systemMessage = `You are a helpful AI assistant with access to real-time market data through the Polygon.io API. 
      
Current datetime: ${easternTime} ET
Market status: ${marketStatus}

When users ask about stock prices, market data, or financial information, you should use the available tools to fetch the actual data. 

Tool usage guidelines:
- For stock prices on a specific date: use getDailyOpenClose (single ticker) or getMultipleDailyOpenClose (multiple tickers)
- For a single option contract: use getOptionPrice - it will find the correct contract and return bid, ask, and last trade prices
- For option chains by moneyness percentage (e.g., "2-5% OTM"): use getOptionsChain
- For option chains by strike price range (e.g., "strikes between 170-200"): use getOptionsChainByStrikes
- NEVER make multiple getOptionPrice calls when users ask for multiple strikes - use the chain tools instead
- Always summarize the results clearly, mentioning any tickers that failed to retrieve data
- When users ask about options with relative dates (e.g., "next Friday"), calculate the actual expiration date first
- IMPORTANT: After receiving tool results, you MUST format and present the data. Never leave the response empty.

Formatting guidelines:
- When returning data for multiple tickers or options, ALWAYS format the output as a well-structured table
- Use markdown table format with proper headers and alignment
- For options chains, include columns like: Strike, Bid, Ask, Last, Volume, OI, IV
- For stock comparisons, include columns like: Ticker, Open, High, Low, Close, Volume
- Make tables easy to read with consistent decimal places for prices

Option pricing display rules:
- When showing option prices, ONLY display: Strike, Bid, Ask, Last (or Mid if no Last available)
- Do NOT include volume, open interest, premium per 100 shares, or Greeks unless specifically requested
- Keep option pricing responses clean and focused on the essential price information
- If the user asks for Greeks, IV, volume, or OI specifically, then include those in the response
- When showing options filtered by moneyness percentage (e.g., "2-4% OTM"), ALWAYS include a "% OTM" or "% ITM" column showing the actual percentage each contract is from the current price
- Calculate % OTM/ITM as: ((Strike - Current Price) / Current Price) × 100 for calls, and ((Current Price - Strike) / Current Price) × 100 for puts

When users refer to relative dates like "yesterday", "last Friday", or "next week", calculate the actual date based on the current datetime provided above.

Data presentation rules:
- NEVER display raw JSON responses under any circumstances
- ALWAYS format data in a human-readable way
- For any pricing data, market data, or numerical comparisons, use well-formatted tables
- Even for single data points, present them clearly with labels, not as raw data
- If a tool returns an error or complex nested data, summarize it in plain language
- Tables are the preferred format for any data that has multiple values or comparisons`;

    // Build messages array
    const messages = conversationHistory.length === 0 
      ? [{ role: 'system', content: systemMessage }]
      : [{ role: 'system', content: systemMessage }, ...conversationHistory];
    
    // Add the user's current message
    messages.push({ role: 'user', content: message });

    // Generate response using OpenAI
    const result = await generateText({
      model: openai('o3-2025-04-16'),
      messages: messages,
      temperature: 1,
      tools: polygonTools,
      maxToolRoundtrips: 3,
    });

    // Prepare response data
    const responseData = {
      response: result.text,
      toolCalls: result.toolCalls?.map(tc => ({
        toolName: tc.toolName,
        args: tc.args
      })) || [],
      usage: result.usage
    };

    res.json(responseData);
    
  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Chat endpoint: POST http://localhost:${PORT}/api/chat`);
}); 