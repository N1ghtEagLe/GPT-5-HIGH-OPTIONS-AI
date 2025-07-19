# AI Market Data Assistant

An AI-powered chatbot that can fetch real-time market data using Polygon.io API and Vercel's AI SDK.

## Features

- **Interactive AI Chat**: Natural language interface powered by OpenAI's o3 model
- **Real-time Market Data**: Fetches stock market data using Polygon.io API
- **Tool Integration**: Uses Vercel AI SDK's tool system for seamless API integration
- **Daily OHLC Data**: Get open, high, low, and close prices for any stock on any date

## Setup

1. **Add your API keys to the `.env` file**:
   - Open the `.env` file in the project root
   - Add your OpenAI API key:
     ```
     OPENAI_API_KEY=sk-your-actual-openai-key-here
     ```
   - Add your Polygon.io API key:
     ```
     POLYGON_API_KEY=your-polygon-api-key-here
     ```
   - You can get a free Polygon API key at [https://polygon.io](https://polygon.io)

2. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

## Running the Assistant

```bash
npm start
```

The assistant will start an interactive chat session where you can ask questions about stock market data.

## Example Questions

- "What was Apple's closing price on 2024-01-15?"
- "Show me the high and low for TSLA on 2024-01-10"
- "Get me the daily data for GOOGL on 2024-01-12"
- "What was Microsoft's opening price yesterday?"
- "Compare Apple and Google's closing prices on 2024-01-10"

## Available Tools

Currently, the assistant has access to:

1. **getDailyOpenClose**: Fetches daily open, high, low, and close prices for a specific stock ticker on a given date
   - Parameters:
     - `ticker`: Stock symbol (e.g., AAPL, GOOGL, TSLA)
     - `date`: Date in YYYY-MM-DD format
     - `adjusted`: Whether to return split-adjusted prices (optional)

## How It Works

1. You ask a question in natural language
2. The AI understands your intent and extracts the necessary parameters
3. It calls the appropriate Polygon.io API through the integrated tools
4. The market data is fetched and returned
5. The AI formats the response in a human-friendly way

## Technical Details

- **AI Model**: OpenAI o3 (with temperature fixed at 1)
- **Market Data**: Polygon.io REST API
- **Framework**: Vercel AI SDK with TypeScript
- **Tool System**: Zod schema validation for type-safe tool parameters

## Troubleshooting

If you get an error:
1. Make sure both API keys are set correctly in the `.env` file
2. Verify you have access to the OpenAI o3 model
3. Check that your Polygon API key has the necessary permissions
4. Ensure the date format is YYYY-MM-DD when asking about specific dates
5. Note that market data is only available for trading days (not weekends/holidays)

## Future Enhancements

More tools can be added to support:
- Real-time quotes
- Historical aggregates (minute, hour, day bars)
- Company news and financials
- Options data
- Crypto and forex data 