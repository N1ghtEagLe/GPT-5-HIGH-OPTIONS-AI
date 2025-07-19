# Deployment Guide: AI Market Data Assistant

This guide explains how to run and deploy the AI Market Data Assistant with separated frontend and backend.

## Architecture Overview

- **Backend**: Express.js API server that wraps the original AI chat logic
- **Frontend**: Next.js application deployed on Vercel
- **Complete separation**: Frontend and backend communicate via REST API

## Local Development

### 1. Start the Backend Server

In the root directory:

```bash
# Install dependencies (if not already done)
npm install

# Start the backend server
npm run server:dev
```

The backend will run on `http://localhost:3001`

Test the backend:
```bash
curl http://localhost:3001/health
```

### 2. Start the Frontend

In a new terminal, navigate to the frontend directory:

```bash
cd frontend

# Create .env.local file
cp env.example .env.local

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend will run on `http://localhost:3000`

## Production Deployment

### Backend Deployment Options

#### Option 1: Deploy to Railway
1. Create account at [railway.app](https://railway.app)
2. Connect your GitHub repository
3. Set root directory to `/`
4. Add environment variables:
   - `OPENAI_API_KEY`
   - `POLYGON_API_KEY`
   - `PORT` (Railway will set this automatically)
5. Update start command to: `node --loader tsx src/server.ts`

#### Option 2: Deploy to Render
1. Create account at [render.com](https://render.com)
2. Create new Web Service
3. Connect GitHub repository
4. Build Command: `npm install`
5. Start Command: `npm run server`
6. Add environment variables

#### Option 3: Deploy to Heroku
1. Install Heroku CLI
2. Create `Procfile` in root:
   ```
   web: npm run server
   ```
3. Deploy:
   ```bash
   heroku create your-app-name
   heroku config:set OPENAI_API_KEY=your-key
   heroku config:set POLYGON_API_KEY=your-key
   git push heroku main
   ```

### Frontend Deployment to Vercel

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Add frontend"
   git push origin main
   ```

2. **Deploy to Vercel**:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Set root directory to `frontend`
   - Add environment variable:
     - `NEXT_PUBLIC_API_URL` = Your backend URL (e.g., `https://your-backend.railway.app`)
   - Deploy

3. **Alternative: Deploy via CLI**:
   ```bash
   cd frontend
   npm install -g vercel
   vercel
   ```

## Environment Variables

### Backend (.env)
```
OPENAI_API_KEY=your-openai-key
POLYGON_API_KEY=your-polygon-key
PORT=3001
```

### Frontend (.env.local for development)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Frontend (Vercel Environment Variables)
```
NEXT_PUBLIC_API_URL=https://your-backend-url.com
```

## API Endpoints

### Backend Endpoints
- `GET /health` - Health check
- `POST /api/chat` - Main chat endpoint

### Request Format
```json
{
  "message": "What is Apple's current stock price?",
  "conversationHistory": []
}
```

### Response Format
```json
{
  "response": "Apple (AAPL) is currently trading at...",
  "toolCalls": [
    {
      "toolName": "getDailyOpenClose",
      "args": { "ticker": "AAPL", "date": "2025-01-15" }
    }
  ],
  "usage": {
    "totalTokens": 150
  }
}
```

## CORS Configuration

The backend is configured to accept requests from any origin in development. For production, update the CORS settings in `src/server.ts`:

```typescript
app.use(cors({
  origin: 'https://your-frontend.vercel.app',
  credentials: true
}));
```

## Monitoring

- Backend logs: Check your hosting platform's log viewer
- Frontend logs: Vercel dashboard → Functions tab
- API health: `curl https://your-backend.com/health`

## Troubleshooting

### Common Issues

1. **"Failed to fetch" error in frontend**
   - Check if backend is running
   - Verify NEXT_PUBLIC_API_URL is correct
   - Check CORS settings

2. **"API key not configured" error**
   - Ensure environment variables are set in backend
   - Restart backend server after adding env vars

3. **Slow responses**
   - OpenAI o3 model can take 10-30 seconds
   - Consider adding loading states in UI

## Security Notes

- Never expose API keys in frontend code
- Use environment variables for all sensitive data
- Consider adding rate limiting to backend
- Add authentication if needed (JWT, API keys)

## Next Steps

1. Add authentication/user management
2. Add database for conversation history
3. Implement WebSocket for real-time updates
4. Add more market data tools
5. Improve error handling and retry logic 