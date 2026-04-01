# DocMind

### AI-Powered Document Intelligence — Ask Your PDFs Anything

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-412991?style=flat-square&logo=openai&logoColor=white)](https://openai.com)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-Vector_DB-FF6B35?style=flat-square)](https://www.trychroma.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

DocMind is a production-grade Retrieval-Augmented Generation (RAG) system that indexes PDF documents as semantic vector embeddings and answers natural language questions by retrieving the most relevant passages and grounding GPT-4o's responses exclusively in your document's content. Built without LangChain or abstraction frameworks — every stage of the pipeline is explicit, inspectable, and documented.

---

## Features

- **PDF ingestion pipeline** — upload any text-based PDF up to 50 MB; automatic text extraction, chunking, embedding, and vector indexing
- **Semantic search** — HNSW cosine similarity search across 1536-dimensional embeddings; retrieves the most contextually relevant passages regardless of keyword overlap
- **Grounded answers** — GPT-4o is constrained by a system prompt to answer ONLY from retrieved document excerpts, with numbered source citations
- **Source transparency** — every answer includes expandable source cards showing the exact document passage, similarity score, and filename
- **Per-document or cross-document querying** — select a specific document from the sidebar to scope search, or query across all indexed documents simultaneously
- **Document management** — list, switch between, and delete indexed documents; ChromaDB chunks are cleaned up on delete
- **Scanned PDF detection** — explicit error message when an image-based PDF is uploaded, prompting the user to run OCR first
- **No LangChain** — direct OpenAI SDK and ChromaDB client usage; the full pipeline is visible in six service/route files

---

## How It Works

```
INDEXING PIPELINE
─────────────────
PDF Upload (multipart/form-data)
    │
    ▼  pdf-parse
Extract Text → { text: string, numPages: number }
    │
    ▼  chunker.chunkText(text, chunkSize=1000, overlap=200)
Chunk Text → Array<{ text, startChar, endChar }>
    │         (boundary-aware: splits at '. ' or '\n\n')
    ▼  embedder.embedBatch()
Embed Chunks → Float32[n][1536]  (OpenAI text-embedding-3-small)
    │           (batches of 100, 100ms delay between batches)
    ▼  vectorStore.storeChunks()
Store in ChromaDB → HNSW cosine index + metadata
    │
    ▼
Response: { documentId, chunks, pages, characters }

QUERY PIPELINE
──────────────
User Question (string)
    │
    ▼  embedder.embedText()
Query Embedding → Float32[1536]
    │
    ▼  vectorStore.searchSimilar(topK=5, documentId?)
HNSW Search → top-5 chunks by cosine similarity
    │
    ▼  filter(score > 0.1)
Relevant Chunks → 1-5 grounded excerpts
    │
    ▼  build context → "[Source N] (file)\n{chunk}"
GPT-4o (temp=0.1) → cited answer
    │
    ▼
Response: { answer, sources[], chunksUsed, tokensUsed }
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS, React Markdown |
| Backend | Node.js 20+, Express 4 |
| File Upload | Multer (disk storage, 50 MB limit) |
| PDF Parsing | pdf-parse |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Vector Database | ChromaDB (HNSW, cosine space) |
| Generation | OpenAI GPT-4o (temperature 0.1) |
| ID Generation | uuid v4 |

---

## Setup

### Prerequisites

- Node.js 20+
- Docker (for ChromaDB)
- An OpenAI API key

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/docmind.git
cd docmind
```

### 2. Start ChromaDB

```bash
docker run -d \
  --name chromadb \
  -p 8000:8000 \
  chromadb/chroma:latest
```

Verify it is running:

```bash
curl http://localhost:8000/api/v1/heartbeat
# → {"nanosecond heartbeat": ...}
```

### 3. Set up the backend

```bash
cd backend
npm install
cp .env.example .env   # or create .env manually
```

Edit `.env`:

```
OPENAI_API_KEY=sk-...your-key-here...
CHROMA_URL=http://localhost:8000
PORT=5000
```

Start the backend:

```bash
node server.js
```

You should see:

```
╔══════════════════════════════════════╗
║  DocMind backend running on :5000   ║
╚══════════════════════════════════════╝
```

### 4. Set up the frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:5000
```

Start the frontend:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## API Reference

### Health Check

```bash
curl http://localhost:5000/api/health
```

```json
{ "status": "ok", "timestamp": "2026-03-23T12:00:00.000Z" }
```

### Upload a PDF

```bash
curl -X POST http://localhost:5000/api/documents/upload \
  -F "document=@/path/to/your/document.pdf"
```

```json
{
  "success": true,
  "documentId": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "pages": 24,
  "chunks": 87,
  "characters": 84203,
  "message": "Document indexed. 87 chunks ready for search."
}
```

### List Documents

```bash
curl http://localhost:5000/api/documents
```

```json
{
  "documents": [
    { "documentId": "550e8400-...", "filename": "document.pdf" }
  ]
}
```

### Ask a Question

```bash
# Ask across all documents
curl -X POST http://localhost:5000/api/chat/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What were the main findings?"}'

# Ask within a specific document
curl -X POST http://localhost:5000/api/chat/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What were the main findings?", "documentId": "550e8400-..."}'
```

```json
{
  "answer": "The main findings were... [Source 1][Source 3]",
  "sources": [
    {
      "index": 1,
      "preview": "The study found that...",
      "filename": "document.pdf",
      "score": "91%",
      "chunkIndex": 14
    }
  ],
  "chunksUsed": 3,
  "tokensUsed": 412
}
```

### Delete a Document

```bash
curl -X DELETE http://localhost:5000/api/documents/550e8400-e29b-41d4-a716-446655440000
```

```json
{ "success": true, "message": "Document removed" }
```

---

## Why No LangChain?

LangChain is a valuable framework for complex multi-agent systems, but for a focused four-stage pipeline like DocMind's, it adds more complexity than it removes:

- **Obscures what is actually happening.** Every RAG tutorial using LangChain hides the embedding call, the vector store query, and the prompt assembly inside framework internals. DocMind makes all of these explicit — you can read exactly what API call is made at each stage.
- **Harder to debug.** When something goes wrong inside a LangChain chain, errors surface inside framework code rather than your code. DocMind's pipeline fails at a named function (`embedBatch`, `searchSimilar`, `storeChunks`) with a clear error message.
- **Rapidly-changing API surface.** LangChain has had multiple breaking major versions. Building on direct SDK calls is more stable.
- **Demonstrates deeper understanding.** An interviewer asking "how does retrieval work in your project?" gets a much more impressive answer when every step is visible in the codebase rather than delegated to `VectorstoreRetriever`.

DocMind uses the OpenAI Node.js SDK directly for embeddings and chat completions, and the `chromadb` npm package directly for vector storage — the same libraries LangChain wraps internally.

---

## What I Learned

**Retrieval-Augmented Generation (RAG):** The pattern of splitting a problem into (1) an offline indexing phase that converts documents to searchable vectors and (2) an online query phase that retrieves relevant context before generation. This grounds LLM responses in specific source material and eliminates hallucination of private document content.

**Vector Embeddings and Semantic Space:** Embedding models map text into a high-dimensional geometric space where semantic similarity corresponds to angular proximity. text-embedding-3-small produces 1536-dimensional vectors via a transformer encoder; the direction of the vector encodes meaning, not its magnitude.

**HNSW Approximate Nearest Neighbour Search:** Hierarchical Navigable Small World graphs enable sub-linear O(log n) similarity search by organising vectors in a multi-layer proximity graph. ChromaDB's HNSW index with cosine distance finds the top-K most similar embeddings in milliseconds even across large collections.

**Chunking Strategy and Boundary Detection:** Large documents must be split into focused passages before embedding. Walking backwards with `lastIndexOf` to find natural sentence/paragraph boundaries, combined with 200-character overlap, prevents context loss at boundaries — a subtlety that directly affects retrieval quality.

**Prompt Engineering for Grounded Generation:** Temperature, the ONLY constraint in the system prompt, the fixed refusal phrase, and the `---` separator between sources are not incidental — each one measurably affects whether GPT-4o faithfully cites the retrieved context or fabricates plausible-sounding but unsupported answers.

**API Rate Limiting and Batch Management:** OpenAI's embeddings endpoint has per-request token limits. Batching to 100 inputs, sorting response items by the returned `index` field (not assumed order), and sleeping 100ms between batches are production-grade details that prevent silent failures on large documents.

---

## Documentation

- [System Architecture](docs/ARCHITECTURE.md) — full pipeline diagrams, data models, and technology decision log
- [Interview Preparation Guide](docs/INTERVIEW_PREP.md) — 20 technical Q&As, system design scenarios, and concept explanations
- [Interactive Flow Diagram](docs/flow-diagram.html) — visual pipeline diagram with animations and concept cards

---

## Screenshots

> Upload the UI screenshot here — e.g. `docs/screenshots/ui-overview.png`

---

## Project Structure

```
docmind/
├── backend/
│   ├── server.js              # Express app, CORS, routes, error handling
│   ├── routes/
│   │   ├── documents.js       # Upload, list, delete endpoints
│   │   └── chat.js            # RAG query endpoint
│   ├── services/
│   │   ├── pdfParser.js       # pdf-parse wrapper with scanned PDF guard
│   │   ├── chunker.js         # Boundary-aware overlapping chunker
│   │   ├── embedder.js        # OpenAI embeddings with batch/rate handling
│   │   └── vectorStore.js     # ChromaDB CRUD and similarity search
│   └── uploads/               # Temporary PDF storage (auto-cleaned)
├── frontend/
│   ├── app/
│   │   └── page.jsx           # Main layout: sidebar + chat area
│   └── components/
│       ├── FileUpload.jsx      # Drag-drop upload with step progress
│       ├── ChatInterface.jsx   # Message thread with typing indicator
│       └── SourceCard.jsx      # Expandable source citation card
└── docs/
    ├── ARCHITECTURE.md         # System design documentation
    ├── INTERVIEW_PREP.md       # Interview Q&A guide
    └── flow-diagram.html       # Interactive pipeline visualisation
```

---

## License

MIT License — see [LICENSE](LICENSE) for details.
