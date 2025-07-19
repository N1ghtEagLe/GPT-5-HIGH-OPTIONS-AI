'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ toolName: string; args: any }>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get response');
      }

      const data = await response.json();
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        toolCalls: data.toolCalls,
      }]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Something went wrong. Please try again.'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (content: string) => {
    // Convert markdown tables to HTML
    const lines = content.split('\n');
    let inTable = false;
    let tableHtml = '';
    let processedContent = '';

    for (const line of lines) {
      if (line.includes('|') && line.includes('-|-')) {
        inTable = true;
        continue;
      }
      
      if (inTable && line.includes('|')) {
        const cells = line.split('|').filter(cell => cell.trim());
        if (tableHtml === '') {
          tableHtml = '<table><thead><tr>';
          cells.forEach(cell => {
            tableHtml += `<th>${cell.trim()}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';
        } else {
          tableHtml += '<tr>';
          cells.forEach(cell => {
            tableHtml += `<td>${cell.trim()}</td>`;
          });
          tableHtml += '</tr>';
        }
      } else if (inTable && !line.includes('|')) {
        tableHtml += '</tbody></table>';
        processedContent += tableHtml;
        tableHtml = '';
        inTable = false;
        processedContent += line + '\n';
      } else {
        processedContent += line + '\n';
      }
    }

    if (tableHtml) {
      tableHtml += '</tbody></table>';
      processedContent += tableHtml;
    }

    // Simple markdown to HTML conversion
    processedContent = processedContent
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br />');

    return <div dangerouslySetInnerHTML={{ __html: processedContent }} />;
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>🤖 AI Market Data Assistant</h1>
        <p style={{ marginTop: '0.5rem', color: '#6c757d' }}>
          Ask me about stock prices, options data, or any market information
        </p>
      </header>

      <div className="chat-messages">
        {messages.map((message, index) => (
          <div key={index} className={`message message-${message.role}`}>
            <div className="message-content">
              {renderMessage(message.content)}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="tool-calls">
                  <div style={{ fontWeight: 600 }}>🔧 Market data retrieved:</div>
                  {message.toolCalls.map((toolCall, idx) => (
                    <div key={idx} className="tool-call">
                      <span className="tool-icon">✓</span>
                      <span>{toolCall.toolName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="loading-indicator">
            <span>AI is thinking</span>
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-form">
        <div className="input-wrapper">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about stock prices, options, or market data..."
            className="chat-input"
            disabled={isLoading}
          />
          <button type="submit" className="send-button" disabled={isLoading}>
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
} 