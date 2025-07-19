import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { polygonTools } from './tools/polygon-tools.js';

// Load environment variables from .env file
dotenv.config();

// Main function to run the chat with tools
async function main() {
  // Check for API keys
  const openAIKey = process.env.OPENAI_API_KEY;
  const polygonKey = process.env.POLYGON_API_KEY;
  
  console.log('🔍 Environment check:');
  console.log(`   OpenAI API key: ${openAIKey ? '✅ Set' : '❌ Not set'}`);
  console.log(`   Polygon API key: ${polygonKey ? '✅ Set' : '❌ Not set'}`);
  console.log('');
  
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
  console.log('Example prompts:');
  console.log('- "What was Apple\'s closing price on 2025-01-10?"');
  console.log('- "Show me the high and low for TSLA on 2025-01-09"');
  console.log('- "Get me the daily data for GOOGL on 2025-01-08"');
  console.log('- "What was AAPL stock price on January 10, 2025?"\n');
  console.log('Type your questions below (or "exit" to quit):\n');

  // Debug: Log available tools
  console.log('🔧 Available tools:', Object.keys(polygonTools));
  console.log('');

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

      try {
        console.log('\n⏳ Processing your request...\n');
        
        // Debug: Log the request details
        console.log('🔍 Debug - Request details:');
        console.log(`   Prompt: "${input}"`);
        console.log(`   Tools provided: ${Object.keys(polygonTools).join(', ')}`);
        console.log('');
        
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
          
          // Determine if market is open (simplified - doesn't account for holidays)
          const easternHour = parseInt(new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            hour12: false
          }).format(now));
          const dayOfWeek = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
          const isWeekday = !['Sat', 'Sun'].includes(dayOfWeek);
          const marketStatus = isWeekday && easternHour >= 9.5 && easternHour < 16 ? 'Open' : 'Closed';
          
          // Generate text using OpenAI with access to Polygon tools
          const result = await generateText({
            model: openai('o3-2025-04-16'),
            prompt: input,
            temperature: 1, // o3 model only supports temperature of 1
            tools: polygonTools, // Include our Polygon tools
            maxToolRoundtrips: 3, // Allow up to 3 tool calls
            // Add system message with current date/time
            system: `You are a helpful AI assistant with access to real-time market data through the Polygon.io API. 
            
Current datetime: ${easternTime} ET
Market status: ${marketStatus}

When users ask about stock prices, market data, or financial information, you should use the available tools to fetch the actual data. Always use the getDailyOpenClose tool when asked about stock prices for specific dates. 

When users refer to relative dates like "yesterday", "last Friday", or "next week", calculate the actual date based on the current datetime provided above.`
          });

        // Debug: Log response details
        console.log('🔍 Debug - Response details:');
        console.log(`   Tool calls made: ${result.toolCalls?.length || 0}`);
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log('   Tool calls:');
          for (const toolCall of result.toolCalls) {
            console.log(`     - ${toolCall.toolName}(${JSON.stringify(toolCall.args)})`);
          }
        }
        console.log('');

        // Display the response
        console.log(`💬 Response:\n${result.text}`);
        
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