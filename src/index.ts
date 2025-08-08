import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { polygonTools } from './tools/polygon-tools.js';
import { webTools } from './tools/web-tools.js';

// Load environment variables from .env file
dotenv.config();

// Debug mode flag - set to false to disable debug output
const DEBUG_MODE = false;

// Set debug mode as environment variable for tools to access
process.env.DEBUG_MODE = DEBUG_MODE.toString();

// Main function to run the chat with tools
async function main() {
  // Check for API keys
  const openAIKey = process.env.OPENAI_API_KEY;
  const polygonKey = process.env.POLYGON_API_KEY;
  
  if (DEBUG_MODE) {
    console.log('🔍 Environment check:');
    console.log(`   OpenAI API key: ${openAIKey ? '✅ Set' : '❌ Not set'}`);
    console.log(`   Polygon API key: ${polygonKey ? '✅ Set' : '❌ Not set'}`);
    console.log('');
  }
  
  if (!openAIKey || openAIKey === 'your-api-key-here') {
    console.error('\n❌ Please set your OpenAI API key in the OPENAI_API_KEY environment variable');
    process.exit(1);
  }
  
  if (!polygonKey || polygonKey === 'your-polygon-api-key-here') {
    console.error('\n❌ Please set your Polygon API key in the POLYGON_API_KEY environment variable');
    console.error('   You can get a free API key at https://polygon.io\n');
    process.exit(1);
  }

  console.log('🤖 AI Market Data Assistant\n');
  console.log('This assistant can fetch real-time market data using Polygon.io API.\n');
  console.log('Example prompts for stocks:');
  console.log('- "What was Apple\'s closing price on 2025-01-10?"');
  console.log('- "Show me the high and low for TSLA on 2025-01-09"');
  console.log('- "Get me the daily data for GOOGL on 2025-01-08"');
  console.log('\nExample prompts for options:');
  console.log('- "What is the price of the AAPL 220 call expiring 2025-01-24?"');
  console.log('- "Show me the bid and ask for SPY 500 put expiring next Friday"');
  console.log('- "Get the price of TSLA 250 call expiring January 31, 2025"\n');
  console.log('Type your questions below (or "exit" to quit):');
  console.log('Commands: /clear - Clear conversation history | /history - Show message count\n');

  // Initialize conversation history array
  const messages: any[] = [];

  // Debug: Log available tools
  if (DEBUG_MODE) {
    console.log('🔧 Available tools:', Object.keys(polygonTools));
    console.log('');
  }

  // Create readline interface for interactive input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Function to handle user input
  const askQuestion = () => {
    rl.question('> ', async (input) => {
      // Exit condition
      if (input.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye!');
        rl.close();
        return;
      }

      // Handle special commands
      if (input.toLowerCase() === '/clear') {
        messages.length = 0;
        console.log('\n🧹 Conversation history cleared!\n');
        askQuestion();
        return;
      }
      
      if (input.toLowerCase() === '/history') {
        const userMessages = messages.filter(m => m.role === 'user').length;
        console.log(`\n📊 Conversation history: ${userMessages} messages (${messages.length} total including system/assistant)\n`);
        askQuestion();
        return;
      }

      try {
        console.log('\n⏳ Processing your request...');
        if (messages.length > 0) {
          console.log(`💭 Using conversation history (${Math.floor(messages.length / 2)} exchanges)\n`);
        } else {
          console.log('');
        }
        
        // Debug: Log the request details
        if (DEBUG_MODE) {
          console.log('🔍 Debug - Request details:');
          console.log(`   Prompt: "${input}"`);
          console.log(`   Tools provided: ${Object.keys(polygonTools).join(', ')}`);
          console.log(`   Message history length: ${messages.length}`);
          console.log('');
        }
        
        // Get current date and time in Eastern Time for system message
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
          
          // Determine if market is open (simplified - doesn't account for holidays)
          const easternHour = parseInt(new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            hour12: false
          }).format(now));
          const dayOfWeek = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
          const isWeekday = !['Sat', 'Sun'].includes(dayOfWeek);
          const marketStatus = isWeekday && easternHour >= 9.5 && easternHour < 16 ? 'Open' : 'Closed';
          
          // Create system message with current datetime
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
- if a user asks for an at the money (or atm) option, for the purposes of the tool call, treat it as a 0% otm option. when looking up calls, select the nearest strike above todays price. when looking up puts, select the nearest strike below todays price.

Browsing and data sourcing rules:
- Use webSearch ONLY for background/context (e.g., earnings call transcripts, news articles, filings, company information)
- NEVER use webSearch to fetch prices, quotes, option prices, Greeks, OI, or any live/dated market data
- ALL market data (prices, quotes, OHLC, options, Greeks if requested) MUST come from Polygon tools

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

          // Build messages array with system message and conversation history
          const currentMessages = [];
          
          // Only add system message if this is the first message
          if (messages.length === 0) {
            currentMessages.push({ role: 'system', content: systemMessage });
          } else {
            // Update system message for existing conversation
            messages[0] = { role: 'system', content: systemMessage };
            currentMessages.push(...messages);
          }
          
          // Add the user's current message
          const userMessage = { role: 'user', content: input };
          currentMessages.push(userMessage);

          // Merge tools
          const tools = { ...polygonTools, ...webTools } as const;

          // Generate text using OpenAI with full message history
          const result = await generateText({
            model: openai('gpt-5-2025-08-07'),
            messages: currentMessages,
            temperature: 1, // o3 model only supports temperature of 1
            tools: tools, // Include Polygon + web tools
            maxToolRoundtrips: 200, // Allow up to 3 tool calls
          });

        // Debug: Log response details
        if (DEBUG_MODE) {
          console.log('🔍 Debug - Response details:');
          console.log(`   Tool calls made: ${result.toolCalls?.length || 0}`);
          if (result.toolCalls && result.toolCalls.length > 0) {
            console.log('   Tool calls:');
            for (const toolCall of result.toolCalls) {
              console.log(`     - ${toolCall.toolName}(${JSON.stringify(toolCall.args)})`);
            }
          }
          console.log('');
        }

        // Display the response
        console.log(`💬 Response:\n${result.text}`);
        
        // Add both user message and assistant response to conversation history
        messages.push(userMessage);
        messages.push({ role: 'assistant', content: result.text });
        
        // Show tool usage if any tools were called
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log('\n🔧 Market data retrieved:');
          for (const toolCall of result.toolCalls) {
            console.log(`   - ${toolCall.toolName}(${JSON.stringify(toolCall.args)})`);
            // Also show the results if available
            if (result.toolResults) {
              console.log(`     Result: ${JSON.stringify(result.toolResults)}`);
            }
          }
        } else {
          console.log('\n⚠️  No tools were used in this response');
        }
        
        // Show token usage if available
        if (result.usage) {
          console.log(`\n📊 Tokens used: ${result.usage.totalTokens}`);
        }
        
        console.log('\n' + '-'.repeat(60) + '\n');
      } catch (error) {
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error('\nFull error:', error);
        console.error('\nMake sure your API keys are valid and you have access to the requested data.\n');
      }

      // Continue asking for input
      askQuestion();
    });
  };

  // Start the interactive loop
  askQuestion();
}

// Run the program
main().catch(console.error); 