/**
 * routes/documents.js
 *
 * Express router handling all document management endpoints:
 *
 *   POST   /api/documents/upload   — Upload a PDF and run the full indexing pipeline
 *   GET    /api/documents          — List all indexed documents
 *   DELETE /api/documents/:id      — Remove a document and all its chunks from ChromaDB
 *
 * INDEXING PIPELINE (triggered by POST /upload):
 *   PDF file → extractTextFromPDF → chunkText → embedBatch → storeChunks
 *
 * Each stage is a separate service module, making the pipeline easy to test,
 * swap out, or extend (e.g. add an OCR stage between pdfParser and chunker).
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Import each pipeline stage
const { extractTextFromPDF } = require('../services/pdfParser');
const { chunkText } = require('../services/chunker');
const { embedBatch } = require('../services/embedder');
const { storeChunks, deleteDocument, listDocuments } = require('../services/vectorStore');

const router = express.Router();

// ── Multer configuration ────────────────────────────────────────────────────
// Multer is a middleware for handling multipart/form-data (file uploads).
// We use disk storage (vs. memory storage) to avoid loading large PDFs into
// Node.js heap memory — a 50 MB PDF kept in memory while being processed could
// cause memory pressure alongside the embedding and ChromaDB API calls.

// UPLOAD_DIR: a local directory for temporary PDF storage.
// The file is deleted in the finally block after indexing completes, so this
// directory only ever holds files that are actively being processed.
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// diskStorage config: control where and under what name files are saved.
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  // Prefix the original filename with a UUID to prevent collisions when two users
  // upload files with the same name (e.g. "report.pdf") simultaneously.
  filename: (_req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB hard limit (prevents DoS via huge files)
  fileFilter: (_req, file, cb) => {
    // Reject anything that isn't a PDF at the MIME type level.
    // This is a first-line check; pdfParser.js performs a deeper validation
    // (checks that the file actually contains extractable text).
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'), false);
    }
  },
});

// ── POST /api/documents/upload ──────────────────────────────────────────────
/**
 * Upload and index a PDF document.
 *
 * Expects: multipart/form-data with field name "document" containing a PDF file.
 *
 * Runs the four-stage pipeline:
 *   1. Extract text  (pdfParser.extractTextFromPDF)
 *   2. Chunk text    (chunker.chunkText)
 *   3. Embed chunks  (embedder.embedBatch)
 *   4. Store chunks  (vectorStore.storeChunks)
 *
 * Returns 201 with indexing statistics, or 400/500 on failure.
 * Always cleans up the temporary file from disk, even on error.
 */
router.post('/upload', upload.single('document'), async (req, res) => {
  // req.file is populated by multer after it saves the upload to disk.
  // If the field name in the form-data is not "document", req.file will be undefined.
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded. Field name must be "document".' });
  }

  // Generate a fresh UUID for this document. This ID is used:
  //   - As the documentId metadata field on every ChromaDB chunk
  //   - As the prefix on every chunk's ChromaDB record ID
  //   - Returned to the frontend so it can activate this document in the sidebar
  const documentId = uuidv4();
  const filename = file.originalname;

  console.log(`\n[upload] Starting pipeline for: ${filename} (${documentId})`);
  const pipelineStart = Date.now();

  try {
    // ── Step 1: Extract text from PDF ─────────────────────────────────────
    // pdfParser reads the file from disk, runs pdf-parse, validates that it
    // contains at least 100 characters of text (rejects scanned PDFs), and
    // returns the raw text string plus page count.
    console.log(`[upload] Step 1/4: Extracting text...`);
    const { text, numPages } = await extractTextFromPDF(file.path);
    console.log(`[upload] Extracted ${text.length} chars from ${numPages} pages`);

    // ── Step 2: Chunk the text ────────────────────────────────────────────
    // chunker.chunkText cleans the text, then splits it into ~1000-char chunks
    // with 200-char overlap at natural sentence/paragraph boundaries.
    // Each chunk is a { text, startChar, endChar } object.
    console.log(`[upload] Step 2/4: Chunking text...`);
    const chunks = chunkText(text);
    console.log(`[upload] Created ${chunks.length} chunks`);

    // ── Step 3: Embed all chunks ──────────────────────────────────────────
    // embedder.embedBatch sends the text of each chunk to OpenAI's
    // text-embedding-3-small API in batches of 100, with a 100ms delay between
    // batches. Returns a parallel array of 1536-dimensional float vectors.
    // embeddings[i] corresponds to chunks[i].
    console.log(`[upload] Step 3/4: Embedding ${chunks.length} chunks...`);
    const embeddings = await embedBatch(chunks.map((c) => c.text));
    console.log(`[upload] Generated ${embeddings.length} embeddings`);

    // ── Step 4: Store in ChromaDB ─────────────────────────────────────────
    // vectorStore.storeChunks writes all chunks, their embeddings, and metadata
    // into ChromaDB's HNSW index in a single batch operation. After this step,
    // the document is immediately searchable via /api/chat/ask.
    console.log(`[upload] Step 4/4: Storing in ChromaDB...`);
    const count = await storeChunks(chunks, embeddings, documentId, filename);

    const elapsed = Date.now() - pipelineStart;
    console.log(`[upload] Pipeline complete in ${elapsed}ms\n`);

    // Return indexing statistics to the frontend. The frontend uses:
    //   - documentId: to add this document to the sidebar and set it as active
    //   - chunks: to display "N chunks indexed" in the upload success message
    //   - pages/characters: for informational display
    return res.status(201).json({
      success: true,
      documentId,
      filename,
      pages: numPages,
      chunks: count,
      characters: text.length,
      message: `Document indexed. ${count} chunks ready for search.`,
    });
  } catch (err) {
    console.error(`[upload] Pipeline error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  } finally {
    // ALWAYS delete the temporary file, whether the pipeline succeeded or failed.
    // Without this cleanup, the uploads/ directory would accumulate every PDF
    // ever uploaded. The try/catch silences the unlink error if the file was
    // already removed (e.g. the OS cleaned it up) — we don't want a secondary
    // error to obscure the original pipeline error in logs.
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
  }
});

// ── GET /api/documents ──────────────────────────────────────────────────────
/**
 * List all documents currently indexed in ChromaDB.
 *
 * Used by the frontend on page load (useEffect in page.jsx) to populate
 * the document list in the sidebar. Returns de-duplicated document records
 * (one per documentId) since each document has many chunks in ChromaDB.
 *
 * @returns {{ documents: Array<{documentId: string, filename: string}> }}
 */
router.get('/', async (_req, res) => {
  try {
    const documents = await listDocuments();
    return res.json({ documents });
  } catch (err) {
    console.error(`[documents] List error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/documents/:documentId ──────────────────────────────────────
/**
 * Remove a document and all its chunks from ChromaDB.
 *
 * Uses ChromaDB's metadata filter to delete every chunk with the matching
 * documentId, regardless of chunk count. The document is immediately unavailable
 * for search after deletion.
 *
 * @param {string} req.params.documentId - The UUID of the document to delete.
 * @returns {{ success: true, message: string }}
 */
router.delete('/:documentId', async (req, res) => {
  const { documentId } = req.params;
  try {
    await deleteDocument(documentId);
    return res.json({ success: true, message: 'Document removed' });
  } catch (err) {
    console.error(`[documents] Delete error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
