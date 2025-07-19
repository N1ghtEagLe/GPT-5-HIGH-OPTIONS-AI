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
  console.log('- "What was Apple\'s closing price on 2024-01-15?"');
  console.log('- "Show me the high and low for TSLA on 2024-01-10"');
  console.log('- "Get me the daily data for GOOGL on 2024-01-12"\n');
  console.log('Type your questions below (or "exit" to quit):\n');

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
        
        // Generate text using OpenAI with access to Polygon tools
        const result = await generateText({
          model: openai('o3-2025-04-16'),
          prompt: input,
          temperature: 1, // o3 model only supports temperature of 1
          tools: polygonTools, // Include our Polygon tools
          maxToolRoundtrips: 3, // Allow up to 3 tool calls
        });

        // Display the response
        console.log(`💬 Response:\n${result.text}`);
        
        // Show tool usage if any tools were called
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log('\n🔧 Market data retrieved:');
          for (const toolCall of result.toolCalls) {
            console.log(`   - ${toolCall.toolName}(${JSON.stringify(toolCall.args)})`);
          }
        }
        
        // Show token usage if available
        if (result.usage) {
          console.log(`\n📊 Tokens used: ${result.usage.totalTokens}`);
        }
        
        console.log('\n' + '-'.repeat(60) + '\n');
      } catch (error) {
        console.error(`\n❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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