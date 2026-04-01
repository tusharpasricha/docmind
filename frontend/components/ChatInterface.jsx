'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, ChevronDown, ChevronUp } from 'lucide-react';
import SourceCard from './SourceCard';

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div
        className="flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold flex-shrink-0 mt-0.5"
        style={{ backgroundColor: '#4472C4' }}
      >
        AI
      </div>
      <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100">
        <div className="flex gap-1 items-center h-5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-dot w-2 h-2 rounded-full"
              style={{ backgroundColor: '#4472C4', animationDelay: `${i * 0.16}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesSection({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {sources.length} source{sources.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="mt-2 grid gap-2">
          {sources.map((src) => (
            <SourceCard key={src.index} source={src} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatInterface({ apiUrl, documentId, documentName, settings, onOpenSettings }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset chat when document changes
  useEffect(() => {
    setMessages([]);
  }, [documentId]);

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${apiUrl}/api/chat/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          documentId: documentId || undefined,
          settings,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Request failed');

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          sources: data.sources,
          chunksUsed: data.chunksUsed || data.chunks_used,
          tokensUsed: data.tokensUsed,
          bestScore: data.best_score,
          avgScore: data.avg_score,
          settingsUsed: data.settings_used,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}`, sources: [] },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm">
        <div>
          <h2 className="font-semibold text-gray-800 text-sm">{documentName}</h2>
          <p className="text-xs text-gray-400">
            {documentId ? 'Searching this document only' : 'Searching all documents'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear chat
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Query Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-sm text-center max-w-xs">
              Ask anything about{' '}
              <span className="font-medium text-gray-600">{documentName}</span>
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}
          >
            {msg.role === 'assistant' && (
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold flex-shrink-0 mr-3 mt-0.5"
                style={{ backgroundColor: '#4472C4' }}
              >
                AI
              </div>
            )}

            <div
              className={`max-w-[78%] ${
                msg.role === 'user'
                  ? 'rounded-2xl rounded-tr-sm px-4 py-3 text-white text-sm'
                  : 'rounded-2xl rounded-tl-sm px-4 py-3 bg-white shadow-sm border border-gray-100'
              }`}
              style={msg.role === 'user' ? { backgroundColor: '#1F3864' } : {}}
            >
              {msg.role === 'user' ? (
                <p className="text-sm">{msg.content}</p>
              ) : (
                <>
                  <div className="prose prose-sm max-w-none text-gray-700">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.tokensUsed > 0 && (
                    <p className="text-xs text-gray-300 mt-2">{msg.tokensUsed} tokens</p>
                  )}
                  <SourcesSection sources={msg.sources} />
                  {/* Metadata footer */}
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    {msg.chunksUsed === 0 ? (
                      <p className="text-xs text-amber-500 flex items-center gap-1">
                        <span>⚠️</span>
                        <span>No matching sections found — try lowering the Relevance Threshold</span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400 font-mono">
                        📄 {msg.chunksUsed} section{msg.chunksUsed !== 1 ? 's' : ''} used
                        {msg.bestScore != null && ` · Best match: ${(msg.bestScore * 100).toFixed(0)}%`}
                        {msg.avgScore != null && ` · Avg: ${(msg.avgScore * 100).toFixed(0)}%`}
                        {msg.settingsUsed?.temperature != null && ` · Temp: ${msg.settingsUsed.temperature.toFixed(2)}`}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {msg.role === 'user' && (
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold flex-shrink-0 ml-3 mt-0.5"
                style={{ backgroundColor: '#6B7280' }}
              >
                U
              </div>
            )}
          </div>
        ))}

        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-100 px-6 py-4">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
            rows={1}
            placeholder="Ask anything about your document..."
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:border-transparent transition-all placeholder-gray-400 disabled:opacity-50"
            style={{ '--tw-ring-color': '#4472C4', minHeight: '48px', maxHeight: '120px' }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#4472C4' }}
            onMouseOver={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = '#3461B3')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#4472C4')}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
