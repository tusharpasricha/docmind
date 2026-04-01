/**
 * pdfParser.js
 *
 * Responsible for Stage 1 of the indexing pipeline: turning a PDF file on disk
 * into a raw text string that downstream services can process.
 *
 * Why pdf-parse?
 *   - Wraps Mozilla's pdf.js internally, the most battle-tested PDF rendering engine
 *   - Exposes a simple async function: pdfParse(buffer) → { text, numpages, info }
 *   - No CLI dependency, no spawned process — pure Node.js
 *   - Trade-off: can only extract text that is embedded as text objects in the PDF.
 *     Scanned documents (where every page is a raster image) will produce no text,
 *     which is why we explicitly detect and reject them below.
 */

const pdfParse = require('pdf-parse');
const fs = require('fs');

/**
 * Extract text content from a PDF file on disk.
 *
 * @param {string} filePath - Absolute path to the PDF file (written by multer).
 * @returns {Promise<{ text: string, numPages: number, info: object }>}
 *   - text:     The full extracted text of the document, with pages concatenated.
 *   - numPages: Total page count (from PDF metadata, not from text parsing).
 *   - info:     Optional PDF metadata object (title, author, creator, etc.).
 * @throws {Error} If the file cannot be read, if pdf-parse fails, or if the
 *                 extracted text is too short to be a text-based PDF.
 */
async function extractTextFromPDF(filePath) {
  const startTime = Date.now();
  console.log(`[pdfParser] Starting extraction: ${filePath}`);

  // ── Step 1: Read the file into a Buffer ──────────────────────────────────
  // pdf-parse expects a Buffer (raw bytes), not a file path string.
  // fs.readFileSync is synchronous here, which is acceptable because:
  //   (a) this is a short-lived background pipeline, not a hot path
  //   (b) wrapping it in try/catch gives clear "file not found" errors
  let dataBuffer;
  try {
    dataBuffer = fs.readFileSync(filePath);
  } catch (err) {
    // Surface a clear error if multer wrote to a temp path we can no longer read
    throw new Error(`Failed to read PDF file: ${err.message}`);
  }

  // ── Step 2: Parse the PDF ────────────────────────────────────────────────
  // pdfParse() is asynchronous. Internally it uses pdf.js to walk each page's
  // content stream and extract text operators, then concatenates them in reading
  // order. For multi-column PDFs the reading order may be imperfect, but it is
  // generally good enough for semantic search purposes.
  let data;
  try {
    data = await pdfParse(dataBuffer);
  } catch (err) {
    // pdf-parse throws if the file is not a valid PDF (bad header, encrypted, etc.)
    throw new Error(`Failed to parse PDF: ${err.message}`);
  }

  // ── Step 3: Destructure the result ──────────────────────────────────────
  // pdf-parse returns numpages (note: lowercase 'n'), so we alias it to numPages
  // for consistency with our API response field names.
  const { text, numpages: numPages, info } = data;

  // ── Step 4: Guard against scanned / image-only PDFs ─────────────────────
  // A scanned PDF contains no text objects — pdf-parse returns an empty string
  // or just whitespace/newlines. We reject anything with fewer than 100 meaningful
  // characters and ask the user to run OCR (e.g. with Adobe Acrobat or tesseract)
  // before uploading. 100 chars is a low threshold on purpose: even a one-page
  // cover sheet with a title and subtitle will exceed it.
  if (!text || text.trim().length < 100) {
    throw new Error(
      'Extracted text is too short (< 100 characters). The PDF may be scanned/image-based and requires OCR.'
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(`[pdfParser] Extracted ${text.length} chars from ${numPages} pages in ${elapsed}ms`);

  // Return the raw text plus metadata. info may be null for minimal PDFs,
  // so we default to an empty object to prevent downstream null-checks.
  return { text, numPages, info: info || {} };
}

module.exports = { extractTextFromPDF };
