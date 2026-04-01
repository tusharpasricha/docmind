require('dotenv').config();

// ── Validate required env vars before anything else ──────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error('[server] FATAL: OPENAI_API_KEY is not set. Add it to your .env file.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');

const documentsRouter = require('./routes/documents');
const chatRouter = require('./routes/chat');

const PORT = process.env.PORT || 5000;

// Allow any localhost/127.0.0.1 port in development (covers 3000, 3001, etc.)
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
};

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/documents', documentsRouter);
app.use('/api/chat', chatRouter);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  DocMind backend running on :${PORT}   ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  console.log(`  Docs:   http://localhost:${PORT}/api/documents`);
  console.log(`  Chat:   POST http://localhost:${PORT}/api/chat/ask\n`);
});

module.exports = app;
