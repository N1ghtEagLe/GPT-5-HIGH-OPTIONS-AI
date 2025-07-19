UNIFIED INSTRUCTIONS - UPDATED

#!/usr/bin/env python3

# ==============================================================================
# Filename: polygon_api_unified_instructions.py
#
# This file merges the following Polygon.io API guides and scripts:
#   1. General Instructions (Stocks & Options Data)
#   2. Polygon Get Option Ticker Script
#   3. Async Instructions
#   4. WebSocket Instructions
#
# Usage:
#   - Set POLYGON_API_KEY in your .env file
#   - pip install polygon-api-client python-dotenv aiohttp websocket-client pytz
#   - python polygon_api_unified_instructions.py
# ==============================================================================

# Polygon API Unified Instruction Document
# ---------------------------------------
#
# This module consolidates various guides and scripts for using the Polygon.io API.
# It includes examples and explanations covering:
#
# 1. General usage for stocks and options data (REST API).
# 2. Retrieving correct option ticker symbols from Polygon.
# 3. Asynchronous requests with aiohttp and asyncio.
# 4. WebSocket connections and real-time streaming.
#
# References:
#  - https://polygon.io/docs/stocks
#  - https://polygon.io/docs/options
#  - https://polygon.io/docs

# ==============================================================================
# SECTION 1: GENERAL INSTRUCTIONS - STOCKS & OPTIONS DATA
# ==============================================================================
#
# POLYGON API GUIDE - STOCKS & OPTIONS DATA
# =========================================
#
# 1. API STRUCTURE
# ----------------
# Polygon's REST API is organized into several main categories:
# - Stocks (/v2/aggs/, /v2/last/...)
# - Options (/v3/snapshot/options/, /v3/reference/options/...)
# - Reference Data (/v3/reference/...)
# Each endpoint accepts specific parameters and returns structured JSON responses.
#
# 2. AUTHENTICATION
# -----------------
# - Store API key in .env file:
#     POLYGON_API_KEY=your_key_here
#
# - Load in Python:
#     from dotenv import load_dotenv
#     load_dotenv()
#     api_key = os.getenv('POLYGON_API_KEY')
#
# 3. BASIC SETUP
# --------------
# Example (using the official Polygon Python client):
#     from polygon import RESTClient
#     client = RESTClient(api_key)
#
# 4. COMMON REQUESTS
# ------------------
# A. STOCKS DATA
#    1. Get Latest Price:
#       last_trade = client.get_last_trade("SPY")
#       price = last_trade.price
#       timestamp = last_trade.sip_timestamp  # in nanoseconds
#
#    2. Get Historical Data:
#       aggs = client.get_aggs(
#           ticker="SPY",
#           multiplier=1,
#           timespan="day",
#           from_="2024-01-01",
#           to="2024-01-31"
#       )
#
# B. OPTIONS DATA
#    1. List Available Contracts:
#       contracts = client.list_options_contracts(
#           underlying_ticker="SPY",
#           expiration_date="2024-01-19",
#           contract_type='call',
#           limit=1000
#       )
#
#    2. Get Option Details (including Greeks):
#       snapshot = client.get_snapshot_option(
#           underlying_asset="SPY",
#           option_contract="O:SPY240119C00400000"
#       )
#
#    3. Access Option Data:
#       bid = snapshot.last_quote.bid
#       ask = snapshot.last_quote.ask
#       delta = snapshot.greeks.delta
#       gamma = snapshot.greeks.gamma
#       theta = snapshot.greeks.theta
#       vega = snapshot.greeks.vega
#       iv = snapshot.implied_volatility
#       oi = snapshot.open_interest
#
# 5. RESPONSE STRUCTURES
# ----------------------
# A. Stock Trade/Quote:
#    - price: Current price
#    - size: Trade size
#    - exchange: Exchange ID
#    - timestamp: Time of trade
#
# B. Option Snapshot:
#    - last_quote: Latest bid/ask
#    - last_trade: Latest trade
#    - greeks: Delta, gamma, theta, vega
#    - implied_volatility: Current IV
#    - open_interest: Total open contracts
#
# C. Option Contract:
#    - ticker: Option symbol
#    - strike_price: Strike price
#    - expiration_date: Expiry date
#    - contract_type: 'call' or 'put'
#
# 5B. IMPORTANT RESPONSE STRUCTURE GOTCHAS
# --------------------------------------
# 1. Option Snapshot Response Structure:
#    snapshot = {
#        "details": {
#            "strike_price": 123.45,     # Strike price is here, NOT in root
#            "contract_type": "call",
#            "expiration_date": "2025-01-19",
#            ...
#        },
#        "greeks": {
#            "delta": 0.5,
#            "gamma": 0.02,
#            ...
#        },
#        "last_quote": {
#            "bid": 1.23,                # Always try bid-ask first
#            "ask": 1.45,
#            ...
#        },
#        "last_trade": {
#            "price": 1.34,              # Fallback to last trade
#            ...
#        }
#    }
#
# 2. Best Practices for Price Data:
#    # CORRECT way to get option price:
#    last_quote = snapshot.get('last_quote', {})
#    bid = last_quote.get('bid', 0)
#    ask = last_quote.get('ask', 0)
#    if bid > 0 and ask > 0:
#        price = (bid + ask) / 2         # Prefer mid-quote
#    else:
#        last_trade = snapshot.get('last_trade', {})
#        price = last_trade.get('price', 0)  # Fallback
#
# 3. Common Mistakes to Avoid:
#    # WRONG - strike price is not in root
#    strike = snapshot.get('strike_price')  # Will return None
#    
#    # CORRECT - strike price is in details
#    strike = snapshot.get('details', {}).get('strike_price')
#
#    # WRONG - using only last trade
#    price = snapshot.get('last_trade', {}).get('price')  # May miss liquid options
#
#    # WRONG - using only bid-ask
#    price = (bid + ask) / 2  # May error if no quotes
#
# 4. Pagination Handling:
#    next_url = None
#    all_results = []
#    
#    while True:
#        data = await get_data(url)
#        results = data.get('results', [])
#        all_results.extend(results)
#        
#        next_url = data.get('next_url')
#        if not next_url:
#            break
#        url = f"{next_url}&apiKey={API_KEY}"
#
# 5. Data Validation:
#    - Always check for None/zero values
#    - Use .get() with default values
#    - Validate prices > 0
#    - Validate Greeks (especially delta != 0)
#    - Handle missing data gracefully
#
# 6. BEST PRACTICES
# -----------------
# 1. Error Handling:
#       try:
#           data = client.get_last_trade("SPY")
#       except Exception as e:
#           print(f"Error: {e}")
#
# 2. Check for None/Empty Results:
#       if snapshot and snapshot.last_quote:
#           bid = snapshot.last_quote.bid
#
# 3. Rate Limiting:
#    - Monitor API usage
#    - Use pagination for large requests
#    - Consider implementing delays between requests
#
# 4. Data Validation:
#    - Verify timestamps are in correct format
#    - Check for missing or null values
#    - Validate price and strike values
#
# 7. EXAMPLE WORKFLOWS
# --------------------
# A. Get ATM Options Chain:
#    1. Get current stock price
#    2. List options for desired expiry
#    3. Filter for strikes near current price
#    4. Fetch snapshots for relevant contracts
#
# B. Historical Data Analysis:
#    1. Get historical stock prices
#    2. Fetch option data for specific dates
#    3. Combine and analyze the data
#
# 8. SUBSCRIPTION TIERS
# ---------------------
# - Basic: Delayed data, limited endpoints
# - Starter: Real-time stocks, basic options
# - Developer: Full options data, real-time
# - Enterprise: Custom solutions
#
# 9. TROUBLESHOOTING
# ------------------
# 1. No Data Returned:
#    - Check API key validity
#    - Verify endpoint permissions
#    - Confirm data availability for timeframe
#
# 2. Rate Limits:
#    - Monitor HTTP response headers
#    - Implement backoff strategies
#    - Consider upgrading subscription
#
# 3. Data Quality:
#    - Verify market hours
#    - Check for corporate actions
#    - Validate option symbols
#
# For more details, visit:
#  - https://polygon.io/docs
#  - https://polygon.io/docs/options
#  - https://polygon.io/docs/stocks


# ==============================================================================
# SECTION 2: POLYGON GET OPTION TICKER SCRIPT
# ==============================================================================
#
# This script shows how to retrieve the *exact* option ticker symbol used by Polygon.io.
# It avoids manual construction of option tickers, which can be error-prone.

import os
from typing import Optional
from dotenv import load_dotenv
from polygon import RESTClient

def get_option_ticker(
    underlying: str,
    expiration: str,
    strike: float,
    option_type: str,
    api_key: Optional[str] = None
) -> str:
    """
    Get the correct Polygon.io option ticker symbol.

    Args:
        underlying (str): Underlying stock symbol (e.g., "SPY", "AAPL")
        expiration (str): Expiration date in YYYY-MM-DD format
        strike (float): Strike price
        option_type (str): Either 'call' or 'put'
        api_key (str, optional): Polygon API key. If None, will look for POLYGON_API_KEY in environment

    Returns:
        str: The official Polygon option ticker symbol

    Raises:
        ValueError: If no matching contract is found or if parameters are invalid
        RuntimeError: If API call fails
    """
    # Input validation
    if option_type.lower() not in ['call', 'put']:
        raise ValueError("option_type must be either 'call' or 'put'")

    # Load API key from environment if not provided
    if api_key is None:
        load_dotenv()
        api_key = os.getenv('POLYGON_API_KEY')
        if not api_key:
            raise ValueError("No API key provided and POLYGON_API_KEY not found in environment")

    # Initialize client
    client = RESTClient(api_key)

    try:
        # Query the API for matching contracts
        contracts = list(client.list_options_contracts(
            underlying_ticker=underlying,
            expiration_date=expiration,
            strike_price=strike,
            contract_type=option_type.lower(),
            limit=1
        ))

        # Check if we found a matching contract
        if not contracts:
            raise ValueError(
                f"No {option_type} contract found for {underlying} "
                f"expiring {expiration} at strike {strike}"
            )

        # Return the ticker symbol
        return contracts[0].ticker

    except Exception as e:
        raise RuntimeError(f"Error fetching option contract: {str(e)}")


# ==============================================================================
# SECTION 3: ASYNC INSTRUCTIONS
# ==============================================================================
#
# Async Polygon.io API Guide
# ==========================
#
# This guide demonstrates how to use asynchronous API calls with Polygon.io.
# Async calls are useful when making multiple API requests concurrently.
#
# Key Concepts:
#  1. aiohttp for async HTTP requests
#  2. asyncio for managing async operations
#  3. Concurrent API calls using asyncio.gather()
#  4. Session management with aiohttp.ClientSession
#  5. Error handling in async context

import asyncio
import aiohttp
from datetime import datetime
import pytz

# Load environment variables again if needed
load_dotenv()
API_KEY = os.getenv('POLYGON_API_KEY')
BASE_URL = "https://api.polygon.io"
TIMEZONE = pytz.timezone('America/New_York')

class AsyncPolygonClient:
    """
    Asynchronous client for Polygon.io API
    
    Demonstrates:
     1. Single async calls
     2. Parallel async calls (asyncio.gather)
     3. Paginated requests
     4. Error handling and retries
    """
    
    def __init__(self, api_key):
        self.api_key = api_key
        self.base_url = BASE_URL
    
    async def _make_request(self, session, url):
        """
        Make a single async HTTP request.
        
        Args:
            session (aiohttp.ClientSession): Open session for HTTP requests
            url (str): Full API endpoint
        
        Returns:
            dict | None: JSON response data if successful, None otherwise
        """
        try:
            async with session.get(url) as response:
                data = await response.json()
                if data.get('status') == 'OK':
                    return data.get('results')
                return None
        except Exception as e:
            print(f"Error making request: {str(e)}")
            return None
    
    async def get_last_trade(self, session, symbol):
        """
        Get the last trade for a given symbol.
        """
        url = f"{self.base_url}/v2/last/trade/{symbol}?apiKey={self.api_key}"
        result = await self._make_request(session, url)
        if result:
            return {
                'price': result['p'],
                'size': result['s'],
                'timestamp': datetime.fromtimestamp(result['t'] / 1000, TIMEZONE)
            }
        return None
    
    async def get_option_contracts(self, session, symbol, expiry):
        """
        Get option contracts for a symbol and expiry. Demonstrates paginated calls.
        """
        url = (
            f"{self.base_url}/v3/reference/options/contracts?"
            f"underlying_ticker={symbol}&"
            f"expiration_date={expiry}&"
            f"limit=1000&"
            f"apiKey={self.api_key}"
        )
        return await self._make_request(session, url)
    
    async def get_option_snapshot(self, session, underlying, option_symbol):
        """
        Get snapshot data for an option contract.
        """
        url = (
            f"{self.base_url}/v3/snapshot/options/{underlying}/"
            f"{option_symbol}?apiKey={self.api_key}"
        )
        return await self._make_request(session, url)
    
    async def get_multiple_snapshots(self, session, contracts):
        """
        Get snapshots for multiple contracts in parallel.
        """
        tasks = []
        for contract in contracts:
            # contract dict typically has 'underlying_ticker' and 'ticker'
            task = self.get_option_snapshot(
                session,
                contract.get('underlying_ticker'),
                contract.get('ticker')
            )
            tasks.append(task)
        
        # Parallel execution
        results = await asyncio.gather(*tasks)
        return [r for r in results if r is not None]


async def run_async_example():
    """
    Example usage of the AsyncPolygonClient.
    Demonstrates:
     - Creating a single aiohttp session
     - Making single and parallel async requests
    """
    if not API_KEY:
        print("Error: No API key found. Add POLYGON_API_KEY to .env file.")
        return
    
    client = AsyncPolygonClient(API_KEY)

    async with aiohttp.ClientSession() as session:
        print("\n1. Getting last trade for SPY...")
        trade = await client.get_last_trade(session, "SPY")
        if trade:
            print(f"Last price: ${trade['price']:.2f}")
            print(f"Last size: {trade['size']}")
            print(f"Time: {trade['timestamp'].strftime('%H:%M:%S')}")

        print("\n2. Getting SPY option contracts...")
        expiry = "2025-01-08"
        contracts = await client.get_option_contracts(session, "SPY", expiry)
        if contracts:
            print(f"Found {len(contracts)} contracts")
            
            print("\n3. Getting snapshots for first 5 contracts...")
            snapshots = await client.get_multiple_snapshots(session, contracts[:5])
            for snapshot in snapshots:
                print(f"Contract: {snapshot['ticker']}")
                if 'last_quote' in snapshot:
                    print(f"Ask: ${snapshot['last_quote']['ask']:.2f}")
                    print(f"Bid: ${snapshot['last_quote']['bid']:.2f}")
                print("---")


# ==============================================================================
# SECTION 4: WEBSOCKET INSTRUCTIONS
# ==============================================================================
#
# WebSocket Setup Template for Polygon.io
# =======================================
#
# Demonstrates how to connect to Polygon.io via WebSocket, authenticate, and
# subscribe to real-time streams (e.g., trades, quotes, aggregates).
#
# Key Points:
#  - wss://socket.polygon.io/stocks  (Real-time)
#  - wss://delayed.polygon.io/stocks (Delayed)
#  - wss://socket.polygon.io/crypto
#  - wss://socket.polygon.io/forex
#
# Usage:
#  - On open, send an auth message with API key
#  - Then subscribe to desired channels (e.g., "T.AAPL")

import json
import websocket

WEBSOCKET_URL = "wss://socket.polygon.io/stocks"  # Real-time stocks WebSocket

def on_message(ws, message):
    """
    Handle incoming messages from the WebSocket connection.
    """
    try:
        data = json.loads(message)
        print(f"Received: {data}")
        
        # Handle different message types
        if isinstance(data, list):
            for item in data:
                event_type = item.get('ev')
                if event_type == 'T':    # Trade
                    handle_trade(item)
                elif event_type == 'Q':  # Quote
                    handle_quote(item)
    except Exception as e:
        print(f"Error processing message: {e}")

def on_error(ws, error):
    """
    Handle WebSocket errors.
    """
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    """
    Handle WebSocket connection closing.
    """
    print(f"Connection closed: {close_msg} (code: {close_status_code})")

def on_open(ws):
    """
    Handle WebSocket connection opening.
    """
    print("Connection opened!")
    
    # 1. Authenticate with your Polygon API key
    auth_message = {"action": "auth", "params": API_KEY}
    ws.send(json.dumps(auth_message))
    
    # 2. Subscribe to desired channels
    subscribe_message = {"action": "subscribe", "params": "T.AAPL"}
    ws.send(json.dumps(subscribe_message))

def handle_trade(trade_data):
    """
    Example function to process trade data.
    """
    symbol = trade_data.get('sym')
    price = trade_data.get('p')
    size = trade_data.get('s')
    print(f"Trade: {symbol} - ${price} - Size: {size}")

def handle_quote(quote_data):
    """
    Example function to process quote data.
    """
    symbol = quote_data.get('sym')
    bid = quote_data.get('bp')
    ask = quote_data.get('ap')
    print(f"Quote: {symbol} - Bid: ${bid} - Ask: ${ask}")

def run_websocket_example():
    """
    Main function to set up and run the WebSocket connection.
    """
    print("Connecting to Polygon.io WebSocket...")
    ws = websocket.WebSocketApp(
        WEBSOCKET_URL,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
        on_open=on_open
    )
    ws.run_forever()

# ==============================================================================
# MAIN ENTRY POINT
# ==============================================================================
if __name__ == "__main__":
    # You can run each section independently for demonstration:
    #   1) Option Ticker Lookup
    #   2) Async Examples
    #   3) WebSocket Example
    #
    # Uncomment as needed.

    # Example 1: Get an option ticker
    # --------------------------------
    try:
        example_ticker = get_option_ticker(
            underlying="SPY",
            expiration="2025-01-15",
            strike=500,
            option_type='call'
        )
        print(f"Got Option Ticker: {example_ticker}")
    except Exception as e:
        print(f"Error fetching option ticker: {e}")

    # Example 2: Run async calls (Stocks & Options)
    # ---------------------------------------------
    # asyncio.run(run_async_example())

    # Example 3: Run WebSocket Example
    # --------------------------------
    # run_websocket_example()

    """
SPY Options Expiry Dates Fetcher
===============================

This script fetches all SPY option expiry dates between Jan 24, 2025 and Dec 19, 2025
using the Polygon.io API reference endpoint.
"""

import os
import asyncio
import aiohttp
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
API_KEY = os.getenv('POLYGON_API_KEY')

# Constants
SYMBOL = "SPY"
START_DATE = "2025-01-24"
END_DATE = "2025-12-19"
BASE_URL = "https://api.polygon.io"

async def get_expiry_dates():
    """Fetch all option expiry dates for SPY within the specified range"""
    
    expiry_dates = set()
    next_url = (f"{BASE_URL}/v3/reference/options/contracts?"
                f"underlying_ticker={SYMBOL}&"
                f"expired=false&"
                f"limit=1000&"  # Maximum limit to get all dates
                f"apiKey={API_KEY}")
    
    try:
        async with aiohttp.ClientSession() as session:
            while next_url:
                async with session.get(next_url) as response:
                    data = await response.json()
                    
                    if data.get('status') != 'OK':
                        print(f"Error: API returned status {data.get('status')}")
                        return
                    
                    # Extract unique expiry dates within our range
                    start_date = datetime.strptime(START_DATE, "%Y-%m-%d")
                    end_date = datetime.strptime(END_DATE, "%Y-%m-%d")
                    
                    for contract in data.get('results', []):
                        expiry = contract.get('expiration_date')
                        if expiry:
                            expiry_date = datetime.strptime(expiry, "%Y-%m-%d")
                            if start_date <= expiry_date <= end_date:
                                expiry_dates.add(expiry)
                    
                    # Check if there are more pages
                    next_url = data.get('next_url')
                    if next_url:
                        next_url = f"{next_url}&apiKey={API_KEY}"
            
            # Sort and print the dates after all pages are processed
            sorted_dates = sorted(list(expiry_dates))
            
            print(f"\nSPY Option Expiry Dates between {START_DATE} and {END_DATE}:")
            print("=" * 50)
            for date in sorted_dates:
                print(date)
            print(f"\nTotal expiry dates found: {len(sorted_dates)}")
                
    except Exception as e:
        print(f"Error fetching data: {str(e)}")

if __name__ == "__main__":
    asyncio.run(get_expiry_dates()) 
