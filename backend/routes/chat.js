/**
 * routes/chat.js
 *
 * Express router for the RAG query pipeline.
 *
 *   POST /api/chat/ask — Accept a natural language question, retrieve relevant
 *                        document chunks, and return a GPT-4o generated answer
 *                        with source citations.
 *
 * QUERY PIPELINE:
 *   question → embedText → searchSimilar → filter → build context → GPT-4o → response
 *
 * This file implements the "Augmented Generation" half of RAG. The "Retrieval"
 * half is handled by vectorStore.searchSimilar, which performs HNSW approximate
 * nearest-neighbour search in ChromaDB.
 */

const express = require('express');
const OpenAI = require('openai');

const { embedText } = require('../services/embedder');
const { searchSimilar } = require('../services/vectorStore');

const router = express.Router();

// ── Configuration constants ─────────────────────────────────────────────────

// GPT-4o chosen for its superior instruction-following and citation discipline.
// See ARCHITECTURE.md Section 6 for detailed reasoning.
const GPT_MODEL = 'gpt-4o';

// Temperature 0.1 — nearly deterministic token sampling.
// WHY LOW TEMPERATURE:
// Language models generate text by sampling from a probability distribution over
// the vocabulary at each token position. Temperature scales this distribution:
//   - Temperature 1.0: sample proportionally (creative, varied, but can hallucinate)
//   - Temperature 0.0: always pick the highest-probability token (deterministic but robotic)
//   - Temperature 0.1: strongly favour the most likely tokens, allow minimal variation
// For document QA the goal is accuracy over creativity. Low temperature makes GPT-4o
// "commit" to the most probable, grounded tokens rather than exploring plausible-sounding
// completions that may not be supported by the retrieved context.
const GPT_TEMPERATURE = 0.1;

// Cap the response length. 1000 tokens (~750 words) is enough for a thorough
// answer with multiple citations. Capping prevents runaway generation and cost.
const GPT_MAX_TOKENS = 1000;

// Minimum cosine similarity score (0.0–1.0) that a retrieved chunk must have
// to be included in the prompt context.
// WHY 0.1:
// Without a threshold, every search returns exactly topK results regardless of
// how semantically relevant they are. A question about "Q3 revenue" might still
// return chunks about "office furniture procurement" with a score of 0.05.
// Sending these low-relevance chunks to GPT-4o wastes tokens and — worse —
// provides misleading context that can cause the model to construct an answer
// around the wrong content. The 0.1 threshold is intentionally low (permissive)
// to avoid rejecting relevant chunks; the main goal is filtering out near-zero
// similarity noise. The system prompt's grounding instruction ("Answer ONLY based
// on the excerpts") is the stronger anti-hallucination mechanism.
const SIMILARITY_THRESHOLD = 0.1;

// Number of results to request from ChromaDB. We retrieve 5 and then filter
// by threshold, so the effective number sent to GPT-4o can be 1–5. Retrieving
// more (e.g. 10) would improve recall but increase token usage per request.
const TOP_K = 5;

// ── System prompt ───────────────────────────────────────────────────────────
// The system prompt establishes GPT-4o's role and constraints for every request.
// Each sentence serves a specific purpose:
//
// "You are a precise document analysis assistant."
//   → Sets the tone: analytical, not conversational. Reduces casual embellishment.
//
// "Answer questions based ONLY on the provided document excerpts."
//   → The core grounding instruction. "ONLY" is capitalised deliberately — GPT-4o
//   responds to emphasis markers and this reduces the probability of the model
//   drawing on its training data knowledge rather than the retrieved context.
//
// "If the answer is not found in the excerpts, say: 'This information is not
//  found in the provided document.'"
//   → Defines the exact refusal phrase. Without this, the model might say
//   "Based on the provided context, I cannot..." or fabricate an answer. A
//   specified phrase makes it easy to detect and handle programmatically.
//
// "Always cite which Source number(s) your answer draws from."
//   → Connects the model's answer text to the [Source N] labels we embed in
//   the user prompt. This enables the frontend to display expandable source cards
//   beneath each answer, giving the user a way to verify the AI's claims.
//
// "Be specific and concise. Never add information not in the excerpts."
//   → Redundant reinforcement of the grounding constraint. Redundancy helps with
//   instruction following on nuanced tasks.
const SYSTEM_PROMPT = `You are a precise document analysis assistant.
Answer questions based ONLY on the provided document excerpts.
If the answer is not found in the excerpts, say:
'This information is not found in the provided document.'
Always cite which Source number(s) your answer draws from.
Be specific and concise. Never add information not in the excerpts.`;

// Lazily initialised OpenAI client — created on first request so that
// process.env.OPENAI_API_KEY is guaranteed to be loaded (by dotenv in server.js)
// before client construction.
let openai;
function getClient() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

// ── POST /api/chat/ask ──────────────────────────────────────────────────────
/**
 * Answer a question using the RAG pipeline.
 *
 * Steps:
 *   1. Embed the question into a 1536-dim vector
 *   2. Search ChromaDB for the topK most similar chunks
 *   3. Filter results below the similarity threshold
 *   4. Build a context string with [Source N] labels
 *   5. Call GPT-4o with the system prompt + context + question
 *   6. Return the answer + structured source metadata
 *
 * @body {string}  question   - The user's natural language question (required)
 * @body {string}  documentId - If provided, restricts search to this document (optional)
 *
 * @returns {object} { answer, sources, chunksUsed, tokensUsed }
 */
router.post('/ask', async (req, res) => {
  const { question, documentId, settings } = req.body;

  // Per-request overrides from req.body.settings, falling back to the annotated
  // constants defined above. This allows the frontend Query Settings panel to
  // override defaults without modifying the server configuration.
  const threshold = settings?.similarity_threshold ?? SIMILARITY_THRESHOLD;
  const topK = settings?.top_k ?? TOP_K;
  const temperature = settings?.temperature ?? GPT_TEMPERATURE;

  // Validate: question must be a non-empty string. Whitespace-only strings
  // (e.g. just spaces or newlines) are rejected after trimming.
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'question must be a non-empty string' });
  }

  const cleanQuestion = question.trim();
  // Truncate the log output at 80 chars to keep server logs readable
  console.log(`\n[chat] Question: "${cleanQuestion.slice(0, 80)}..."`);
  const startTime = Date.now();

  try {
    // ── Step 1: Embed the question ──────────────────────────────────────────
    // Convert the user's question into the same 1536-dimensional vector space
    // that was used to embed the document chunks during indexing. This is
    // fundamental: if you indexed with model A but query with model B, the vectors
    // live in different geometric spaces and cosine similarity is meaningless.
    // Both embedText() and embedBatch() use the same EMBEDDING_MODEL constant.
    console.log('[chat] Step 1/3: Embedding question...');
    const queryEmbedding = await embedText(cleanQuestion);

    // ── Step 2: Search ChromaDB ─────────────────────────────────────────────
    // vectorStore.searchSimilar sends queryEmbedding to ChromaDB's HNSW index
    // and retrieves the topK most semantically similar chunk embeddings.
    // If documentId is provided, the search is restricted to that document's chunks.
    // Returns an array of { text, metadata, score } objects, sorted by descending score.
    console.log('[chat] Step 2/3: Searching vector store...');
    const rawResults = await searchSimilar(queryEmbedding, topK, documentId || null);

    // ── Step 3: Filter by similarity threshold ──────────────────────────────
    // rawResults always contains exactly topK items (or fewer if the collection
    // has fewer items). Not all of them are necessarily relevant — ChromaDB always
    // returns the "best available" results even if they are poor matches.
    // We discard chunks below the threshold to prevent noise from reaching GPT-4o.
    const relevantChunks = rawResults.filter((r) => r.score > threshold);
    console.log(
      `[chat] Found ${relevantChunks.length}/${rawResults.length} chunks above threshold ${threshold}`
    );

    // Short-circuit: if no chunks pass the threshold, there is no relevant context
    // and we return the canned "not found" response without calling GPT-4o at all.
    // This saves API cost and prevents GPT-4o from generating a hallucinated answer
    // when presented with an empty or irrelevant context.
    if (relevantChunks.length === 0) {
      // Compute the best score from rawResults so the frontend can show the user
      // how close the nearest chunk was, helping them tune their threshold setting.
      const bestScore = rawResults.length > 0
        ? Math.round(Math.max(...rawResults.map((r) => r.score)) * 10000) / 10000
        : 0;
      return res.json({
        answer: 'No sufficiently relevant sections found. Try lowering the Relevance Threshold.',
        sources: [],
        chunks_used: 0,
        best_score: bestScore,
        avg_score: 0,
        settings_used: { similarity_threshold: threshold, top_k: topK, temperature },
      });
    }

    // ── Step 4: Build the context string ───────────────────────────────────
    // Each chunk is formatted as:
    //   "[Source N] (filename.pdf)\n{chunk text}"
    //
    // WHY [Source N] LABELS:
    // The system prompt instructs GPT-4o to cite source numbers in its answer.
    // The labels in the context string ([Source 1], [Source 2], etc.) give the
    // model explicit reference points to cite. Without labels, GPT-4o would have
    // no way to indicate which excerpt supports which claim.
    // The frontend reads the sources[] array in the response to render source
    // cards beneath the answer, with index numbers matching the [Source N] labels
    // that appear in the answer text.
    const contextParts = relevantChunks.map(
      (chunk, i) =>
        `[Source ${i + 1}] (${chunk.metadata.filename})\n${chunk.text}`
    );

    // WHY '---' SEPARATOR:
    // The `---` separator between excerpts (and between excerpts and the question)
    // is a visual and semantic delimiter that helps GPT-4o parse the prompt
    // structure. Without separators, the model might treat the boundary between
    // two chunks as continuous text, potentially blending context from different
    // parts of the document or misidentifying where one source ends and another
    // begins. The `---` is a widely recognised "horizontal rule" in markdown and
    // in GPT-4o's training data, making it a reliable structural signal.
    const contextString = contextParts.join('\n---\n');

    // The final user prompt combines all excerpts with a clear "Question:" label
    // and an "Answer with citations:" instruction to reinforce citation behaviour.
    const userPrompt = `Document excerpts:\n${contextString}\n---\nQuestion: ${cleanQuestion}\nAnswer with citations:`;

    // ── Step 5: Call GPT-4o ─────────────────────────────────────────────────
    // We use the chat completions endpoint with two messages:
    //   - system: establishes role, constraints, and citation requirement
    //   - user: the context excerpts + the actual question
    // This two-message structure allows the system prompt to be cached server-side
    // in future (OpenAI supports prompt caching for repeated system prompts).
    console.log('[chat] Step 3/3: Calling GPT-4o...');
    const client = getClient();
    const completion = await client.chat.completions.create({
      model: GPT_MODEL,
      temperature: temperature, // per-request value (defaults to GPT_TEMPERATURE)
      max_tokens: GPT_MAX_TOKENS,   // cap at 1000 tokens to control cost
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    // Extract the generated answer from the first (and only) completion choice.
    const answer = completion.choices[0].message.content;
    // usage may be undefined if the API call failed partially; default to 0.
    const tokensUsed = completion.usage?.total_tokens ?? 0;

    // ── Step 6: Build the sources array ────────────────────────────────────
    // The sources array is returned to the frontend for rendering source cards.
    // Each source corresponds to one [Source N] reference in the answer text.
    //   - preview: first 200 chars of the chunk (shown in the collapsed card)
    //   - score: converted to a percentage string (e.g. "87%") for the ScorePill
    //   - chunkIndex: the 0-based position of this chunk within its document
    const sources = relevantChunks.map((chunk, i) => ({
      index: i + 1,                              // 1-based, matches [Source N] in answer
      preview: chunk.text.slice(0, 200),         // first 200 chars shown in SourceCard
      filename: chunk.metadata.filename,
      score: `${Math.round(chunk.score * 100)}%`, // e.g. 0.874 → "87%"
      chunkIndex: chunk.metadata.chunkIndex,
    }));

    // Compute best_score and avg_score from the relevantChunks scores for the
    // frontend metadata footer, so users can see how well the query matched.
    const scores = relevantChunks.map((r) => r.score);
    const bestScore = Math.round(Math.max(...scores) * 10000) / 10000;
    const avgScore = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10000) / 10000;

    const elapsed = Date.now() - startTime;
    console.log(`[chat] Response generated in ${elapsed}ms, tokens: ${tokensUsed}\n`);

    return res.json({
      answer,
      sources,
      chunksUsed: relevantChunks.length,
      tokensUsed,
      chunks_used: relevantChunks.length,
      best_score: bestScore,
      avg_score: avgScore,
      settings_used: { similarity_threshold: threshold, top_k: topK, temperature },
    });
  } catch (err) {
    console.error(`[chat] Error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
