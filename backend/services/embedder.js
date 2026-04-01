/**
 * embedder.js
 *
 * Responsible for Stage 3 of the indexing pipeline (and Step 1 of the query
 * pipeline): converting text strings into dense vector embeddings using
 * OpenAI's text-embedding-3-small model.
 *
 * WHAT IS AN EMBEDDING?
 * ─────────────────────
 * An embedding is a fixed-length array of floating-point numbers (a vector)
 * that encodes the semantic meaning of a piece of text. The model is trained
 * such that texts with similar meanings produce vectors that point in similar
 * directions in the 1536-dimensional space. This enables similarity search:
 * "What are the revenue figures?" and "Total sales for Q3 were $4.2M" will
 * produce vectors close to each other, even though they share no keywords.
 *
 * WHY text-embedding-3-small?
 * ─────────────────────────────
 * - 1536 dimensions: enough resolution for document QA tasks
 * - Significantly cheaper than text-embedding-3-large (3072 dims, ~5x cost)
 * - Outperforms the older text-embedding-ada-002 on MTEB benchmarks
 * - Same model MUST be used at both index time and query time. If you
 *   indexed with model A and query with model B, the vectors live in
 *   different geometric spaces and cosine similarity is meaningless.
 */

const OpenAI = require('openai');

// The embedding model name — kept as a named constant so that changing the model
// requires only one edit, and the constant can be exported for validation elsewhere.
const EMBEDDING_MODEL = 'text-embedding-3-small';

// The output dimensionality of the chosen model. This must match the dimension
// ChromaDB was configured to accept. Exported so vectorStore.js can reference it.
const EMBEDDING_DIMENSIONS = 1536;

// OpenAI's embeddings endpoint accepts a maximum of 2048 inputs per request,
// but in practice the per-request token limit is 300 000 tokens across all inputs.
// Using 100 as our batch size is a conservative, safe limit that stays well within
// both the input count limit and token budget for typical document chunks.
const BATCH_SIZE = 100;

// A short sleep between batches to avoid triggering OpenAI's rate limiter.
// OpenAI's rate limits are measured in tokens-per-minute (TPM) and
// requests-per-minute (RPM). For most API tiers, 100ms between batches of 100
// embeddings is more than sufficient to stay under limits while keeping the
// pipeline fast. Without this delay, a document with 500 chunks (5 batches)
// would fire all 5 requests within milliseconds and risk a 429 error.
const BATCH_DELAY_MS = 100;

// Lazy-initialise the OpenAI client on first use rather than at module load time.
// This ensures process.env.OPENAI_API_KEY is already populated (by dotenv in
// server.js) before the client is constructed.
let openai;

/**
 * Return the shared OpenAI client instance, creating it on first call.
 * @returns {OpenAI}
 */
function getClient() {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Simple promisified sleep.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Embed a single text string — used by the query pipeline in chat.js.
 *
 * This is a thin wrapper around the embeddings API that returns just the
 * embedding array for the first (and only) input.
 *
 * @param {string} text - The query text to embed (e.g. the user's question).
 * @returns {Promise<number[]>} A vector of EMBEDDING_DIMENSIONS floats.
 */
async function embedText(text) {
  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  // response.data is an array of EmbeddingObject; we asked for one input, so [0].
  return response.data[0].embedding;
}

/**
 * Embed an array of texts in batches — used by the indexing pipeline.
 *
 * Sending all texts in one API call is tempting but risky: a document with
 * 500 chunks would send a single request with ~75 000 tokens, potentially
 * hitting per-request token limits. Batching to 100 items per request keeps
 * us safely within limits and allows us to add rate-limiting delays between calls.
 *
 * @param {string[]} texts - Array of chunk texts to embed (from chunker.js).
 * @returns {Promise<number[][]>} Array of embedding vectors, in the same order
 *   as the input `texts` array. Length equals texts.length.
 */
async function embedBatch(texts) {
  const client = getClient();
  const allEmbeddings = [];
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

  console.log(`[embedder] Embedding ${texts.length} texts in ${totalBatches} batch(es)`);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

    // Slice the texts array to get this batch. Array.slice(start, end) is
    // safe when end exceeds array length — it just returns the remaining items.
    const batch = texts.slice(i, i + BATCH_SIZE);

    console.log(`[embedder] Batch ${batchIndex}/${totalBatches} — ${batch.length} texts`);
    const startTime = Date.now();

    // Send this batch to the embeddings API. The API accepts an array of strings
    // in the `input` field and returns them as response.data[], each element
    // having an `index` (position in the input array) and an `embedding` array.
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    // WHY SORT BY INDEX:
    // The OpenAI embeddings API does not guarantee that response.data[] items
    // are returned in the same order as the input array. In practice they usually
    // are, but the API specification only guarantees that each item has an `index`
    // field identifying which input it corresponds to. Sorting by `index` before
    // extracting the embedding ensures the output order matches the input order,
    // which is critical: we later zip embeddings[i] with chunks[i] in vectorStore.
    const embeddings = response.data
      .sort((a, b) => a.index - b.index)  // sort ascending by position in input
      .map((item) => item.embedding);      // extract just the float array

    // Spread the sorted embeddings into the accumulator array.
    // Using push(...embeddings) rather than concat() avoids creating an
    // intermediate array on every iteration.
    allEmbeddings.push(...embeddings);

    const elapsed = Date.now() - startTime;
    console.log(`[embedder] Batch ${batchIndex} done in ${elapsed}ms`);

    // Only sleep if there are more batches to process. No point sleeping after
    // the last batch since there are no subsequent API calls to rate-limit.
    if (i + BATCH_SIZE < texts.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // At this point allEmbeddings.length === texts.length, and allEmbeddings[i]
  // is the 1536-dimensional vector for texts[i].
  return allEmbeddings;
}

module.exports = { embedText, embedBatch, EMBEDDING_DIMENSIONS };
