/**
 * vectorStore.js
 *
 * Responsible for Stage 4 of the indexing pipeline (storing) and Step 2 of
 * the query pipeline (searching): all interactions with ChromaDB.
 *
 * WHAT IS CHROMADB?
 * ─────────────────
 * ChromaDB is an open-source vector database that stores embeddings alongside
 * their associated text and metadata. It builds an HNSW (Hierarchical Navigable
 * Small World) index over the stored vectors, enabling approximate nearest-
 * neighbour search in sub-linear time even with millions of entries.
 *
 * WHY CHROMADB (vs Pinecone, pgvector, Weaviate)?
 * ─────────────────────────────────────────────────
 * - Runs locally as a Docker container: no cloud dependency, no API keys,
 *   data stays on-machine
 * - Single `docker run` setup vs. schema migrations (pgvector) or cluster config
 * - JavaScript client with async/await support
 * - Full metadata filtering support (needed for per-document search scope)
 * - Suitable for development and small-to-medium production workloads
 */

const { ChromaClient } = require('chromadb');

// All chunks across all documents are stored in a single ChromaDB collection.
// A "collection" in ChromaDB is analogous to a table in SQL or an index in
// Elasticsearch. We use one collection and differentiate documents via metadata.
const COLLECTION_NAME = 'docmind';

// ChromaDB server address. In development this is localhost:8000 (Docker).
// Can be overridden via environment variable for production deployments.
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';

// Module-level singletons: create the client and collection once and reuse them
// for all subsequent calls. This avoids the overhead of establishing a new HTTP
// connection on every request.
let client;
let collection;

/**
 * Lazily initialise and return the ChromaDB collection.
 *
 * getOrCreateCollection() is idempotent: if the collection already exists on
 * the ChromaDB server (e.g. after a server restart), it returns the existing one;
 * if not, it creates a new one with the specified metadata.
 *
 * @returns {Promise<Collection>} The ChromaDB collection instance.
 */
async function getCollection() {
  // Return cached collection if already initialised
  if (collection) return collection;

  // Create the ChromaDB HTTP client if needed
  if (!client) {
    client = new ChromaClient({ path: CHROMA_URL });
  }

  // ── WHY hnsw:space: 'cosine' ────────────────────────────────────────────
  // This metadata key tells ChromaDB which distance metric to use for the
  // HNSW index it builds over the stored vectors.
  //
  // HNSW (Hierarchical Navigable Small World) is a graph-based approximate
  // nearest-neighbour (ANN) algorithm. It builds a multi-layer proximity graph
  // where each node (embedding) is connected to its nearest neighbours. At query
  // time it navigates the graph greedily from a random entry point, converging
  // on the approximate nearest neighbours in O(log n) time rather than the O(n)
  // time required by brute-force linear scan.
  //
  // Cosine similarity measures the angle between two vectors:
  //   similarity = (A · B) / (|A| × |B|)
  // A value of 1.0 means the vectors point in the same direction (identical
  // meaning); 0.0 means they are orthogonal (unrelated); -1.0 means opposite.
  //
  // For text embeddings we care about DIRECTION (semantic meaning), not MAGNITUDE
  // (which encodes frequency/length effects). Cosine similarity is therefore more
  // appropriate than euclidean distance for semantic search.
  //
  // Note: ChromaDB reports cosine DISTANCE (0 = identical, 2 = opposite), which
  // is 1 minus cosine similarity. We convert back to similarity in searchSimilar().
  collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { 'hnsw:space': 'cosine' },
  });

  console.log(`[vectorStore] Connected to collection "${COLLECTION_NAME}" at ${CHROMA_URL}`);
  return collection;
}

/**
 * Store chunks and their embeddings into ChromaDB.
 *
 * Called at the end of the indexing pipeline (documents.js Step 4/4).
 * Stores the chunk text, its embedding, and metadata identifying which
 * document and position in the document this chunk came from.
 *
 * @param {Array<{text: string, startChar: number, endChar: number}>} chunks
 *   The chunks produced by chunker.js.
 * @param {number[][]} embeddings
 *   The embeddings produced by embedder.js. embeddings[i] corresponds to chunks[i].
 * @param {string} documentId
 *   UUID assigned to this document at upload time. Used for per-document filtering.
 * @param {string} filename
 *   Original PDF filename (e.g. "annual-report-2024.pdf"). Displayed in source cards.
 * @returns {Promise<number>} The number of chunks successfully stored.
 */
async function storeChunks(chunks, embeddings, documentId, filename) {
  const col = await getCollection();
  const startTime = Date.now();

  // ChromaDB requires:
  //   ids:       unique string ID for each record
  //   embeddings: the float arrays
  //   documents: the text (stored for later retrieval without a separate DB)
  //   metadatas: arbitrary key-value metadata for filtering and display

  // IDs are scoped to documentId to ensure uniqueness across documents.
  // Format: "${documentId}_chunk_0", "${documentId}_chunk_1", etc.
  const ids = chunks.map((_, i) => `${documentId}_chunk_${i}`);

  // The "documents" field in ChromaDB stores the raw text alongside the vector.
  // This means when we query, we get the text back directly without needing a
  // separate database lookup — ChromaDB is serving as both vector index and
  // document store for this use case.
  const documents = chunks.map((c) => c.text);

  // Metadata is stored as a flat key-value object. ChromaDB supports filtering
  // queries by metadata fields (see searchSimilar's where: { documentId } usage).
  // startChar/endChar are stored for potential future features (e.g. highlighting
  // the relevant passage in a PDF viewer).
  const metadatas = chunks.map((c, i) => ({
    documentId,           // which document this chunk belongs to
    filename,             // human-readable name for display in source cards
    chunkIndex: i,        // 0-based position within this document
    startChar: c.startChar, // byte offset in cleaned text (for future highlighting)
    endChar: c.endChar,
  }));

  // col.add() sends all chunks in a single request to ChromaDB. ChromaDB then
  // indexes all embeddings into the HNSW graph in one batch operation, which is
  // more efficient than adding items one-by-one.
  await col.add({ ids, embeddings, documents, metadatas });

  const elapsed = Date.now() - startTime;
  console.log(`[vectorStore] Stored ${chunks.length} chunks for ${filename} in ${elapsed}ms`);
  return chunks.length;
}

/**
 * Search for the most semantically similar chunks given a query embedding.
 *
 * This is the retrieval step in RAG. ChromaDB performs an approximate
 * nearest-neighbour search using its HNSW index and returns the top-K closest
 * vectors along with their associated text and metadata.
 *
 * @param {number[]} queryEmbedding
 *   The 1536-dimensional embedding of the user's question (from embedder.embedText).
 * @param {number} topK
 *   Maximum number of results to return (default 5).
 * @param {string|null} documentId
 *   If provided, restricts the search to chunks belonging to this document.
 *   This is the per-document scoping feature: when a user selects a specific
 *   document in the sidebar, we only retrieve from that document's chunks.
 *   Without this filter, the search spans all documents in the collection.
 * @returns {Promise<Array<{text: string, metadata: object, score: number}>>}
 *   Results sorted by descending similarity score (most relevant first).
 */
async function searchSimilar(queryEmbedding, topK = 5, documentId = null) {
  const col = await getCollection();
  const startTime = Date.now();

  // Build the query parameters object.
  // We always request 'documents', 'metadatas', and 'distances'.
  // 'distances' is the key field: ChromaDB returns cosine DISTANCE values which
  // we convert to similarity scores in the mapping step below.
  const queryParams = {
    queryEmbeddings: [queryEmbedding], // wrapped in outer array: one query at a time
    nResults: topK,
    include: ['documents', 'metadatas', 'distances'],
  };

  // WHY PER-DOCUMENT FILTERING MATTERS:
  // Without a documentId filter, a question asked while "Document A" is selected
  // could surface chunks from "Document B" — wrong context for the user's intent.
  // ChromaDB's `where` clause performs exact metadata matching as a pre-filter
  // before the vector similarity search, so only chunks with matching documentId
  // are considered. This is more efficient than post-filtering.
  if (documentId) {
    queryParams.where = { documentId };
  }

  const results = await col.query(queryParams);

  const elapsed = Date.now() - startTime;
  console.log(`[vectorStore] Search returned ${results.ids[0].length} results in ${elapsed}ms`);

  // ── Convert ChromaDB distances to similarity scores ────────────────────
  // ChromaDB with hnsw:space='cosine' returns DISTANCES in the range [0, 2]:
  //   distance = 0.0 → vectors are identical (cosine similarity = 1.0)
  //   distance = 1.0 → vectors are orthogonal (cosine similarity = 0.0)
  //   distance = 2.0 → vectors point in opposite directions (similarity = -1.0)
  //
  // For text embeddings, distances beyond 1.0 are extremely rare (embeddings
  // from the same model rarely point in opposite directions). We convert to
  // the more intuitive similarity score: score = 1 - distance
  //   score = 1.0 → perfect match
  //   score = 0.0 → completely unrelated
  //   score < 0   → theoretically possible but practically never seen
  //
  // results.ids[0], results.documents[0], etc. are arrays because col.query()
  // supports multiple simultaneous query embeddings (we always pass exactly one,
  // hence [0] to access the results for our single query).
  const items = results.ids[0].map((id, idx) => ({
    text: results.documents[0][idx],
    metadata: results.metadatas[0][idx],
    score: 1 - results.distances[0][idx], // distance → similarity
  }));

  // Sort descending by score so the most relevant chunk is always items[0].
  // ChromaDB usually returns results already sorted by distance, but an explicit
  // sort here makes the contract clear and guards against any future API changes.
  return items.sort((a, b) => b.score - a.score);
}

/**
 * Delete all chunks belonging to a given document from ChromaDB.
 *
 * Called by DELETE /api/documents/:documentId. Uses ChromaDB's metadata filter
 * (`where: { documentId }`) to delete all records matching this document,
 * regardless of how many chunks were stored.
 *
 * @param {string} documentId - The UUID of the document to remove.
 * @returns {Promise<void>}
 */
async function deleteDocument(documentId) {
  const col = await getCollection();
  // col.delete() with a where clause removes all matching records.
  // No need to know chunk IDs — the metadata filter handles it.
  await col.delete({ where: { documentId } });
  console.log(`[vectorStore] Deleted all chunks for documentId: ${documentId}`);
}

/**
 * List all unique documents currently stored in ChromaDB.
 *
 * Fetches all metadata records and deduplicates by documentId using a Map.
 * Returns one entry per document with its documentId and original filename.
 * Used by GET /api/documents to populate the sidebar document list on page load.
 *
 * @returns {Promise<Array<{documentId: string, filename: string}>>}
 */
async function listDocuments() {
  const col = await getCollection();
  // col.get() with include: ['metadatas'] fetches all records but only returns
  // the metadata field (not the full embeddings, which would be large).
  const results = await col.get({ include: ['metadatas'] });

  // Use a Map keyed by documentId to deduplicate: a 50-chunk document has 50
  // metadata records but should appear as one entry in the document list.
  const seen = new Map();
  for (const meta of results.metadatas) {
    if (meta && meta.documentId && !seen.has(meta.documentId)) {
      seen.set(meta.documentId, { documentId: meta.documentId, filename: meta.filename });
    }
  }

  return Array.from(seen.values());
}

module.exports = { storeChunks, searchSimilar, deleteDocument, listDocuments };
