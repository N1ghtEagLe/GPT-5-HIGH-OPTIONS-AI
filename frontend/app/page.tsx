'use client';

import { useState, useRef, useEffect } from 'react';
import ChartCard, { type ChartMessageChart } from './components/ChartCard';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ toolName: string; args: any }>;
  images?: Array<{ previewUrl: string; mimeType: string }>;
  modelUsed?: string;
  charts?: ChartMessageChart[];
}

type AttachmentStatus = 'processing' | 'ready' | 'error';
interface Attachment {
  id: string;
  file?: File;
  mimeType: string;
  previewUrl: string;
  dataBase64: string;
  status: AttachmentStatus;
  error?: string;
}

interface SessionImage {
  mimeType: string;
  previewUrl: string;
  dataBase64: string;
}

type ModelId = 'o3-2025-04-16' | 'gpt-5-2025-08-07';
const MODEL_OPTIONS: Array<{ id: ModelId; label: string }> = [
  { id: 'o3-2025-04-16', label: 'o3' },
  { id: 'gpt-5-2025-08-07', label: 'GPT-5' }
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [authError, setAuthError] = useState('');
  const [authenticatedPin, setAuthenticatedPin] = useState(''); // Store PIN after auth
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState('');
  const [sessionImages, setSessionImages] = useState<SessionImage[]>([]);
  const [model, setModel] = useState<ModelId>('o3-2025-04-16');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [input]);

  const MAX_ATTACHMENTS = 3;
  const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  const readFileAsDataURL = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const compressImage = async (file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> => {
    const dataUrl = await readFileAsDataURL(file);
    const img = document.createElement('img');
    img.src = dataUrl;
    await new Promise((r, j) => { img.onload = () => r(null); img.onerror = j; });

    const maxDim = 1600;
    const { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, outW, outH);

    const mime = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    const quality = 0.8;
    const compressedDataUrl = canvas.toDataURL(mime, quality);
    const base64 = compressedDataUrl.split(',')[1] || '';
    return { base64, mimeType: mime, previewUrl: compressedDataUrl };
  };

  const addFiles = async (files: FileList | File[]) => {
    setAttachError('');
    const current = [...attachments];
    const spaceLeft = MAX_ATTACHMENTS - current.length;
    const toAdd = Array.from(files).slice(0, Math.max(0, spaceLeft));
    if (toAdd.length === 0) {
      setAttachError(`Max ${MAX_ATTACHMENTS} images`);
      return;
    }
    const newOnes: Attachment[] = toAdd.map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      mimeType: file.type,
      previewUrl: '',
      dataBase64: '',
      status: 'processing',
    }));
    setAttachments(prev => [...prev, ...newOnes]);

    for (const a of newOnes) {
      try {
        if (!ALLOWED_TYPES.has(a.mimeType)) throw new Error('Unsupported file type');
        const { base64, mimeType, previewUrl } = await compressImage(a.file as File);
        setAttachments(prev => prev.map(x => x.id === a.id ? { ...x, dataBase64: base64, mimeType, previewUrl, status: 'ready' } : x));
      } catch (err: any) {
        setAttachments(prev => prev.map(x => x.id === a.id ? { ...x, status: 'error', error: err?.message || 'Failed to process image' } : x));
      }
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length > 0) {
      e.preventDefault();
      await addFiles(imgs);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      await addFiles(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };

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
    if (!input.trim() && attachments.length === 0) return;
    if (isLoading) return;
    if (attachments.some(a => a.status === 'processing')) return;

    const userMessage = input.trim();
    const ready = attachments.filter(a => a.status === 'ready');
    const useImages: SessionImage[] = (ready.length > 0
      ? ready.map(a => ({ previewUrl: a.previewUrl, mimeType: a.mimeType, dataBase64: a.dataBase64 }))
      : sessionImages);
    const outgoingImages = useImages.map(a => ({ previewUrl: a.previewUrl, mimeType: a.mimeType }));
    const payloadImages = useImages.map(a => ({ mimeType: a.mimeType, dataBase64: a.dataBase64 }));
    setInput('');
    setAttachments([]);
    if (ready.length > 0) {
      setSessionImages(ready.map(a => ({ previewUrl: a.previewUrl, mimeType: a.mimeType, dataBase64: a.dataBase64 })));
    }
    setMessages(prev => [...prev, { role: 'user', content: userMessage || '(sent images)', images: outgoingImages }]);
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
          images: payloadImages.length > 0 ? payloadImages : undefined,
          model,
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
        modelUsed: data.model,
        charts: Array.isArray(data.charts) ? data.charts : undefined,
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

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const clearSessionImages = () => {
    setSessionImages([]);
  };

  const renderMessage = (content: string) => {
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks: string[] = [];
    let processedContent = content.replace(codeBlockRegex, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    const tableBlocks: string[] = [];

    const convertTableToHtml = (lines: string[]): string => {
      let html = '<table>';
      let headerProcessed = false;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.match(/^\|?[\s\-\|:]+\|?$/)) continue;

        const hasEdgePipes = line.startsWith('|') && line.endsWith('|');
        const cells = (hasEdgePipes ? line.slice(1, -1) : line)
          .split('|')
          .map(cell => escapeHtml(cell.trim()))
          .filter(cell => cell.length > 0);

        if (cells.length === 0) continue;

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

      if (!headerProcessed) return '<table></table>';
      html += '</tbody></table>';
      return html;
    };

    const extractTables = (text: string): string => {
      const lines = text.split('\n');
      let inTable = false;
      let currentOriginal: string[] = [];
      let currentTrimmed: string[] = [];
      let result = text;

      const flushTable = () => {
        if (currentOriginal.length > 0 && currentTrimmed.length > 2) {
          const originalBlock = currentOriginal.join('\n');
          const tableHtml = convertTableToHtml(currentTrimmed);
          const placeholder = `__TABLE_BLOCK_${tableBlocks.length}__`;
          tableBlocks.push(tableHtml);
          result = result.replace(originalBlock, placeholder);
        }
        currentOriginal = [];
        currentTrimmed = [];
        inTable = false;
      };

      for (let i = 0; i < lines.length; i++) {
        const originalLine = lines[i];
        const trimmedLine = originalLine.trim();
        const isSeparator = trimmedLine.match(/^\|?[\s\-\|:]+\|?$/) && trimmedLine.includes('-');

        if (isSeparator) {
          if (!inTable && i > 0 && lines[i - 1].includes('|')) {
            inTable = true;
            currentOriginal = [lines[i - 1], originalLine];
            currentTrimmed = [lines[i - 1].trim(), trimmedLine];
            continue;
          }

          if (inTable) {
            currentOriginal.push(originalLine);
            currentTrimmed.push(trimmedLine);
            continue;
          }
        }

        if (inTable) {
          if (trimmedLine.includes('|')) {
            currentOriginal.push(originalLine);
            currentTrimmed.push(trimmedLine);
          } else {
            flushTable();
          }
        }
      }

      if (inTable) flushTable();
      return result;
    };

    processedContent = extractTables(processedContent);
    processedContent = escapeHtml(processedContent)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br />');

    tableBlocks.forEach((html, index) => {
      processedContent = processedContent.replace(`__TABLE_BLOCK_${index}__`, html);
    });

    codeBlocks.forEach((block, index) => {
      let inner = block;
      const startFence = inner.match(/^```[^\n]*\n?/);
      if (startFence) inner = inner.slice(startFence[0].length);
      if (inner.endsWith('```')) inner = inner.slice(0, -3);
      const innerNoCarriage = inner.replace(/\r/g, '');
      const trimmedLines = innerNoCarriage.trim().split('\n').map(line => line.trim());
      const looksLikeTable =
        trimmedLines.length >= 2 &&
        trimmedLines[0].includes('|') &&
        trimmedLines[1] &&
        trimmedLines[1].match(/^\|?[\s\-\|:]+\|?$/) &&
        trimmedLines[1].includes('-') &&
        trimmedLines.slice(2).some(line => line.includes('|'));

      if (looksLikeTable) {
        const tableHtml = convertTableToHtml(trimmedLines);
        processedContent = processedContent.replace(`__CODE_BLOCK_${index}__`, tableHtml);
      } else {
        const escapedCode = escapeHtml(innerNoCarriage);
        processedContent = processedContent.replace(
          `__CODE_BLOCK_${index}__`,
          `<pre><code>${escapedCode}</code></pre>`
        );
      }
    });

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
        <div className="chat-header-sub">
          <p>Ask me about stock prices, options data, or any market information</p>
          <div className="model-select-group">
            <select
              id="model-select"
              value={model}
              onChange={(e) => {
                const next = e.target.value as ModelId;
                setModel(next);
              }}
              className="model-select"
              aria-label="Select model"
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="chat-messages">
        {messages.map((message, index) => (
          <div key={index} className={`message message-${message.role}`}>
            <div className="message-content">
              {renderMessage(message.content)}
              {message.charts && message.charts.length > 0 && (
                <div className="message-charts">
                  {message.charts.map((chart, i) => (
                    <ChartCard key={chart.id || `chart-${index}-${i}`} chart={chart} />
                  ))}
                </div>
              )}
              {message.images && message.images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {message.images.map((img, i) => (
                    <img key={i} src={img.previewUrl} alt="attachment" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #e1e3e6' }} />
                  ))}
                </div>
              )}
              {message.role === 'assistant' && ((message.toolCalls?.length || 0) > 0 || !!message.modelUsed) && (
                <>
                  <div
                    onClick={() => setExpandedTools((prev) => ({ ...prev, [index]: !prev[index] }))}
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      marginTop: '8px',
                      cursor: 'pointer',
                      color: '#6c757d',
                      userSelect: 'none',
                    }}
                    aria-label={expandedTools[index] ? 'Hide response details' : 'Show response details'}
                    title={expandedTools[index] ? 'Hide response details' : 'Show response details'}
                  >
                    <span style={{ fontSize: '16px' }}>{expandedTools[index] ? '▴' : '▾'}</span>
                  </div>
                  {expandedTools[index] && (
                    <div className="tool-calls" style={{ marginTop: '8px' }}>
                      {message.modelUsed && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#495057', marginBottom: message.toolCalls && message.toolCalls.length > 0 ? 8 : 0 }}>
                          <span style={{ fontWeight: 600 }}>🧠 Model:</span>
                          <span>{message.modelUsed}</span>
                        </div>
                      )}
                      {message.toolCalls && message.toolCalls.length > 0 && (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: '6px' }}>🔧 Market data retrieved:</div>
                          {message.toolCalls.map((toolCall, idx) => (
                            <div key={idx} className="tool-call" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#495057' }}>
                              <span className="tool-icon">✓</span>
                              <span>{toolCall.toolName}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </>
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
        <div className="input-wrapper" onDrop={onDrop} onDragOver={onDragOver}>
          {attachments.length === 0 && sessionImages.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#6c757d' }}>Including previous chart</span>
              <button type="button" onClick={clearSessionImages} aria-label="Stop auto-including chart" title="Stop auto-including chart" style={{
                background: 'transparent', border: 'none', color: '#6c757d', cursor: 'pointer', fontSize: 16, lineHeight: 1
              }}>×</button>
              {sessionImages.map((si, idx) => (
                <img key={idx} src={si.previewUrl} alt="session chart" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid #e1e3e6' }} />
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {attachments.map(att => (
                <div key={att.id} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid #e1e3e6', background: '#fafbfc' }}>
                  {att.previewUrl ? (
                    <img src={att.previewUrl} alt="attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c757d', fontSize: 12 }}>…</div>
                  )}
                  <button type="button" onClick={() => removeAttachment(att.id)} aria-label="Remove" title="Remove"
                    style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 4px', cursor: 'pointer' }}>×</button>
                  <div style={{ position: 'absolute', bottom: 2, left: 2, right: 2, textAlign: 'center', fontSize: 11, color: att.status === 'ready' ? '#198754' : att.status === 'error' ? '#dc3545' : '#6c757d', background: 'rgba(255,255,255,0.85)', borderRadius: 3, padding: '0 2px' }}>
                    {att.status === 'ready' ? 'Attached ✓' : att.status === 'processing' ? 'Processing…' : (att.error || 'Error')}
                  </div>
                </div>
              ))}
            </div>
          )}
          {attachError && <div style={{ color: '#dc3545', marginBottom: 6, fontSize: 12 }}>{attachError}</div>}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              // Check if on mobile device
              const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
              
              if (e.key === 'Enter') {
                if (isMobile) {
                  // On mobile, Enter creates new line
                  return; // Allow default behavior
                } else if (!e.shiftKey) {
                  // On desktop, Enter sends (if not holding Shift)
                  e.preventDefault();
                  handleSubmit(e);
                }
                // Desktop + Shift+Enter creates new line (default behavior)
              }
            }}
            placeholder="Ask about markets or paste a chart screenshot..."
            className="chat-input"
            disabled={isLoading}
            rows={1}
            ref={textareaRef}
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
