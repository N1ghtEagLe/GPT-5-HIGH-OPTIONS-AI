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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [authenticatedPin, setAuthenticatedPin] = useState(''); // Store PIN after auth
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin }),
      });

      if (response.ok) {
        setIsAuthenticated(true);
        setAuthenticatedPin(pin); // Store the PIN for future requests
        setPin(''); // Clear the input field
      } else {
        const error = await response.json();
        setAuthError(error.error || 'Invalid PIN');
      }
    } catch (error) {
      setAuthError('Failed to authenticate. Please try again.');
    }
  };

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
          pin: authenticatedPin, // Use the stored authenticated PIN
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
    // First, let's handle code blocks to prevent table parsing inside them
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks: string[] = [];
    let processedContent = content.replace(codeBlockRegex, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Function to detect and parse tables
    const parseTable = (text: string): string => {
      // Split into lines
      const lines = text.split('\n');
      let result = text;
      let inTable = false;
      let tableStart = -1;
      let tableLines: string[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Check if this looks like a table separator (contains | and -)
        if (line.match(/^\|?[\s\-\|:]+\|?$/) && line.includes('-')) {
          // This is likely a separator line
          if (i > 0 && lines[i - 1].includes('|')) {
            // We found a table!
            inTable = true;
            tableStart = i - 1;
            tableLines = [lines[i - 1], line];
          }
        } else if (inTable) {
          if (line.includes('|')) {
            tableLines.push(line);
          } else if (line.trim() === '' || !line.includes('|')) {
            // End of table
            if (tableLines.length > 2) {
              const tableHtml = convertTableToHtml(tableLines);
              const originalTable = tableLines.join('\n');
              result = result.replace(originalTable, tableHtml);
            }
            inTable = false;
            tableLines = [];
          }
        }
      }
      
      // Handle case where table goes to end of content
      if (inTable && tableLines.length > 2) {
        const tableHtml = convertTableToHtml(tableLines);
        const originalTable = tableLines.join('\n');
        result = result.replace(originalTable, tableHtml);
      }
      
      return result;
    };
    
    // Function to convert table lines to HTML
    const convertTableToHtml = (lines: string[]): string => {
      let html = '<table>';
      let headerProcessed = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip separator lines
        if (line.match(/^\|?[\s\-\|:]+\|?$/)) {
          continue;
        }
        
        // Parse cells - handle both with and without leading/trailing pipes
        let cells: string[];
        if (line.startsWith('|') && line.endsWith('|')) {
          cells = line.slice(1, -1).split('|').map(cell => cell.trim());
        } else if (line.includes('|')) {
          cells = line.split('|').map(cell => cell.trim());
        } else {
          continue;
        }
        
        // Remove empty cells
        cells = cells.filter(cell => cell.length > 0);
        
        if (cells.length === 0) continue;
        
        // First row with data is header
        if (!headerProcessed) {
          html += '<thead><tr>';
          cells.forEach(cell => {
            html += `<th>${cell}</th>`;
          });
          html += '</tr></thead><tbody>';
          headerProcessed = true;
        } else {
          html += '<tr>';
          cells.forEach(cell => {
            html += `<td>${cell}</td>`;
          });
          html += '</tr>';
        }
      }
      
      html += '</tbody></table>';
      return html;
    };

    // Parse tables
    processedContent = parseTable(processedContent);

    // Restore code blocks
    codeBlocks.forEach((block, index) => {
      processedContent = processedContent.replace(`__CODE_BLOCK_${index}__`, block);
    });

    // Convert other markdown elements
    processedContent = processedContent
      .replace(/```(.*?)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br />');

    return <div dangerouslySetInnerHTML={{ __html: processedContent }} />;
  };

  // Show PIN entry form if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="chat-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="auth-form">
          <h1>💰 OptionsGPT</h1>
          <p style={{ marginTop: '0.5rem', marginBottom: '2rem', color: '#6c757d' }}>
            Enter your PIN to access the chat
          </p>
          <form onSubmit={handlePinSubmit}>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="pin-input"
              autoFocus
              required
            />
            {authError && (
              <p className="auth-error">{authError}</p>
            )}
            <button type="submit" className="auth-button">
              Access Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>💰 OptionsGPT</h1>
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
      <div className="copyright">
        © V. Shyfrin
      </div>
    </div>
  );
}