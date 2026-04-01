/**
 * chunker.js
 *
 * Responsible for Stage 2 of the indexing pipeline: splitting a long document
 * string into smaller, overlapping chunks that are suitable for embedding.
 *
 * WHY CHUNKING IS NECESSARY
 * ─────────────────────────
 * OpenAI's text-embedding-3-small model has an input limit of 8192 tokens
 * (~32 000 characters). More importantly, a 1536-dimensional vector must encode
 * the entire meaning of its input: a 50-page document compressed into a single
 * vector loses so much detail that similarity search becomes useless. Chunking
 * creates many focused embeddings, each representing a specific passage, so
 * that retrieval can surface the exact paragraphs relevant to a question.
 *
 * CHUNK SIZE: 1000 characters (~150–250 tokens)
 *   Large enough to contain a complete thought/argument.
 *   Small enough that the embedding captures focused meaning.
 *
 * OVERLAP: 200 characters
 *   Ensures information at chunk boundaries is not lost — a sentence split
 *   across two chunks is fully represented in at least one of them.
 */

// Minimum chunk length guard: chunks shorter than this (e.g. a lone page header
// like "Chapter 3") are semantically useless and inflate the index. Discard them.
const MIN_CHUNK_LENGTH = 50;

/**
 * Clean raw PDF text by normalising line endings and collapsing excess whitespace.
 *
 * pdf-parse sometimes returns Windows-style CRLF line endings (\r\n) or bare
 * carriage returns (\r) depending on how the PDF was produced. We normalise
 * everything to Unix LF (\n) first so that downstream boundary detection with
 * `indexOf('\n\n')` works reliably regardless of the source OS.
 *
 * @param {string} text - Raw text from pdfParser.
 * @returns {string} Cleaned text.
 */
function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')   // Windows CRLF → Unix LF
    .replace(/\r/g, '\n')     // bare CR (old Mac) → LF
    .replace(/[ \t]+/g, ' ')  // collapse runs of spaces/tabs to a single space
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ blank lines to exactly 2 (paragraph break)
    .trim();                  // remove leading/trailing whitespace
}

/**
 * Split text into overlapping chunks at natural sentence/paragraph boundaries.
 *
 * Algorithm overview:
 *   1. Start at pos=0. Project forward by chunkSize characters to find `end`.
 *   2. If not at the very end of the document, search backwards from `end` for
 *      the last paragraph break (\n\n) or sentence boundary ('. ') that falls
 *      in the second half of the window (past halfwayPoint). Using the last
 *      occurrence rather than the first avoids cutting early, maximising chunk size.
 *   3. Slice the chunk from pos to sliceEnd and store it.
 *   4. Advance pos to sliceEnd - overlap, so the next chunk re-reads the last
 *      200 characters of this one (the overlap), preserving cross-boundary context.
 *
 * @param {string} text        - Raw document text (will be cleaned internally).
 * @param {number} chunkSize   - Target maximum characters per chunk (default 1000).
 * @param {number} overlap     - Characters of overlap between consecutive chunks (default 200).
 * @returns {Array<{ text: string, startChar: number, endChar: number }>}
 */
function chunkText(text, chunkSize = 1000, overlap = 200) {
  const startTime = Date.now();
  const cleaned = cleanText(text);
  const chunks = [];

  let pos = 0;

  while (pos < cleaned.length) {
    // `end` is the furthest character we are allowed to include in this chunk.
    // Math.min prevents reading past the end of the string.
    const end = Math.min(pos + chunkSize, cleaned.length);
    let sliceEnd = end; // default: hard-cut at end (used when no boundary found)

    // ── Natural boundary search ─────────────────────────────────────────────
    // We only search for a boundary if we are NOT at the final segment of the
    // document (end < cleaned.length). If we're at the end, just take everything.
    if (end < cleaned.length) {

      // halfwayPoint: the character position halfway through this chunk window.
      // WHY: We require any discovered boundary to be past this point. Without
      // this guard, `lastIndexOf` could find a boundary near the very START of
      // the window (e.g. a paragraph break at character pos+10), producing a
      // tiny chunk and wasting index entries. By enforcing that the boundary must
      // be in the second half of the window, we guarantee chunks are at least
      // 50% of the target chunk size.
      const halfwayPoint = pos + Math.floor((end - pos) * 0.5);

      // PARAGRAPH BOUNDARY (preferred)
      // lastIndexOf('\n\n', end) walks BACKWARDS from `end` to find the last
      // double-newline in the window. Walking backwards (vs. indexOf from pos)
      // is important: we want the LATEST natural break point to maximise the
      // amount of text in this chunk. If we walked forwards we'd cut at the
      // first paragraph break, producing a chunk that might be only 200 chars.
      const paraBreak = cleaned.lastIndexOf('\n\n', end);
      if (paraBreak >= halfwayPoint) {
        // +2 to include both newline characters in this chunk (keeps the paragraph
        // separator with the paragraph it closes, not the one it opens).
        sliceEnd = paraBreak + 2;
      } else {
        // SENTENCE BOUNDARY (fallback)
        // Same backwards-walk logic: find the last '. ' (period-space) before `end`.
        // '. ' (with a trailing space) is a stronger heuristic than just '.' because
        // it avoids cutting inside abbreviations like "Fig." or decimal numbers "3.14".
        const sentBreak = cleaned.lastIndexOf('. ', end);
        if (sentBreak >= halfwayPoint) {
          // +2 includes the period and the space so the chunk ends cleanly.
          sliceEnd = sentBreak + 2;
        }
        // If no sentence boundary found past halfwayPoint either, sliceEnd stays
        // at `end` — a hard character cut. This is rare but handles pathological
        // inputs like base64 blobs or tables with no spaces.
      }
    }

    const chunkText = cleaned.slice(pos, sliceEnd).trim();

    // Only store chunks that meet the minimum length. This discards artifacts like
    // lone page numbers, headers ("CHAPTER 1"), or whitespace-only slices.
    if (chunkText.length >= MIN_CHUNK_LENGTH) {
      chunks.push({ text: chunkText, startChar: pos, endChar: sliceEnd });
    }

    // ── Overlap calculation ─────────────────────────────────────────────────
    // nextPos = sliceEnd - overlap
    //
    // WHY OVERLAP PREVENTS CONTEXT LOSS:
    // Suppose sliceEnd = 1000 and overlap = 200. The next chunk starts at pos=800,
    // meaning characters 800-1000 appear in BOTH this chunk and the next. If a
    // relevant sentence begins at character 950, it will be captured in full within
    // the next chunk (which extends to ~1800), even though it also appears at the
    // tail of this chunk (truncated). Without overlap, a sentence split exactly at
    // chunk boundary 1000 could be split across two chunks, causing the embedding
    // of each chunk to miss the complete sentence's meaning.
    //
    // The `nextPos > pos` guard is a safety check to prevent an infinite loop.
    // It can only fail if overlap >= chunkSize (a misconfiguration), in which case
    // we advance to sliceEnd to ensure progress.
    const nextPos = sliceEnd - overlap;
    pos = nextPos > pos ? nextPos : sliceEnd;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[chunker] Created ${chunks.length} chunks from ${cleaned.length} chars in ${elapsed}ms`);

  return chunks;
}

module.exports = { chunkText };
