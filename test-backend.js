// Test script for backend API
// Run with: node test-backend.js

const API_URL = 'http://localhost:3001';

async function testHealth() {
  console.log('Testing health endpoint...');
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    console.log('✅ Health check:', data);
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
  }
}

async function testChat() {
  console.log('\nTesting chat endpoint...');
  try {
    const response = await fetch(`${API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: "What is Apple's closing price on 2025-01-10?",
        conversationHistory: []
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Chat request failed:', error);
      return;
    }
    
    const data = await response.json();
    console.log('✅ Chat response received');
    console.log('   Response:', data.response.substring(0, 100) + '...');
    console.log('   Tool calls:', data.toolCalls);
    console.log('   Tokens used:', data.usage?.totalTokens);
  } catch (error) {
    console.error('❌ Chat request failed:', error.message);
  }
}

async function runTests() {
  console.log('🧪 Testing Backend API\n');
  console.log(`API URL: ${API_URL}\n`);
  
  await testHealth();
  await testChat();
  
  console.log('\n✨ Tests complete!');
}

runTests(); 