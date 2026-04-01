'use client';

import { useState, useEffect, useCallback } from 'react';
import FileUpload from '../components/FileUpload';
import ChatInterface from '../components/ChatInterface';
import SettingsPanel from '../components/SettingsPanel';
import { Trash2, FileText, Brain, MessageSquare } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function Home() {
  const [documents, setDocuments] = useState([]);
  const [activeDocumentId, setActiveDocumentId] = useState(null); // null = all docs
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [settings, setSettings] = useState(() => {
    if (typeof window === 'undefined') return { similarity_threshold: 0.35, top_k: 5, temperature: 0.1 };
    try {
      const saved = localStorage.getItem('docmind_settings');
      return saved ? JSON.parse(saved) : { similarity_threshold: 0.35, top_k: 5, temperature: 0.1 };
    } catch {
      return { similarity_threshold: 0.35, top_k: 5, temperature: 0.1 };
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('docmind_settings', JSON.stringify(settings));
  }, [settings]);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents`);
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error('Failed to fetch documents', err);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUploadSuccess = (result) => {
    setDocuments((prev) => [...prev, { documentId: result.documentId, filename: result.filename, chunks: result.chunks }]);
    setActiveDocumentId(result.documentId);
  };

  const handleDelete = async (docId, e) => {
    e.stopPropagation();
    try {
      await fetch(`${API_URL}/api/documents/${docId}`, { method: 'DELETE' });
      setDocuments((prev) => prev.filter((d) => d.documentId !== docId));
      if (activeDocumentId === docId) setActiveDocumentId(null);
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const activeDoc = documents.find((d) => d.documentId === activeDocumentId);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        className="flex flex-col w-70 flex-shrink-0 text-white"
        style={{ width: '280px', backgroundColor: '#1F3864' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg"
            style={{ backgroundColor: '#4472C4' }}
          >
            <Brain size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">DocMind</h1>
            <p className="text-xs text-blue-200/70">AI Document Intelligence</p>
          </div>
        </div>

        {/* Upload */}
        <div className="px-4 py-4 border-b border-white/10">
          <FileUpload
            apiUrl={API_URL}
            onSuccess={handleUploadSuccess}
            isUploading={isUploading}
            setIsUploading={setIsUploading}
            uploadProgress={uploadProgress}
            setUploadProgress={setUploadProgress}
          />
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-200/50 mb-2">
            Documents
          </p>

          {/* All Documents option */}
          <button
            onClick={() => setActiveDocumentId(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors mb-1 ${
              activeDocumentId === null
                ? 'bg-white/15 text-white font-medium'
                : 'text-blue-100/70 hover:bg-white/10'
            }`}
          >
            <MessageSquare size={15} />
            <span>All Documents</span>
          </button>

          {documents.length === 0 && (
            <p className="text-xs text-blue-200/40 px-3 py-4 text-center">
              No documents yet. Upload a PDF to get started.
            </p>
          )}

          {documents.map((doc) => (
            <div
              key={doc.documentId}
              onClick={() => setActiveDocumentId(doc.documentId)}
              className={`group w-full flex items-start gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer mb-1 ${
                activeDocumentId === doc.documentId
                  ? 'bg-white/15 text-white'
                  : 'text-blue-100/70 hover:bg-white/10'
              }`}
            >
              <FileText size={15} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-xs leading-tight">
                  {doc.filename}
                </p>
                {doc.chunks && (
                  <p className="text-xs text-blue-200/40 mt-0.5">{doc.chunks} chunks</p>
                )}
              </div>
              <button
                onClick={(e) => handleDelete(doc.documentId, e)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/20 text-blue-200/60 hover:text-red-300 flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10">
          <p className="text-xs text-blue-200/30">Powered by GPT-4o + ChromaDB</p>
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {documents.length === 0 && !isUploading ? (
          // Empty state
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md px-6">
              <div
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
                style={{ backgroundColor: '#EEF2FF' }}
              >
                <Brain size={32} style={{ color: '#1F3864' }} />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-3">Welcome to DocMind</h2>
              <p className="text-gray-500 text-sm leading-relaxed mb-6">
                Upload a PDF document using the sidebar, then ask natural language questions.
                DocMind uses semantic search and GPT-4o to give you cited, accurate answers.
              </p>
              <div className="grid grid-cols-3 gap-3 text-left">
                {[
                  { step: '1', text: 'Upload a PDF from the sidebar' },
                  { step: '2', text: 'Wait for indexing to complete' },
                  { step: '3', text: 'Ask questions in natural language' },
                ].map(({ step, text }) => (
                  <div key={step} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold mb-2"
                      style={{ backgroundColor: '#4472C4' }}
                    >
                      {step}
                    </span>
                    <p className="text-xs text-gray-600">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // Chat interface
          <ChatInterface
            apiUrl={API_URL}
            documentId={activeDocumentId}
            documentName={activeDoc?.filename || 'All Documents'}
            settings={settings}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      <SettingsPanel
        isOpen={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
