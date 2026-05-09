/**
 * Vectorize Memories — hourly cron script
 *
 * Reads conversations from the last hour, extracts facts using LLM,
 * generates embeddings via Google Gemini or OpenAI-compatible API,
 * and stores them as MemoryEntry records with deduplication.
 *
 * Usage:
 *   node api/scripts/vectorize-memories.js
 *
 * Required env vars:
 *   MONGO_URI              — MongoDB connection string (default: mongodb://localhost:27017/LibreChat)
 *   GOOGLE_API_KEY         — Google Gemini API key for embeddings (required for Google provider)
 *   EXTRACTION_API_URL     — LLM API base URL for fact extraction (default: http://127.0.0.1:1234/v1/chat/completions)
 *   EXTRACTION_MODEL       — LLM model for extraction (default: gpt-4.1-mini)
 *   EXTRACTION_API_KEY     — API key for extraction LLM
 *
 * Schedule (crontab):
 *   0 * * * * cd /path/to/LibreChat && node api/scripts/vectorize-memories.js >> /var/log/vectorize-memories.log 2>&1
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/LibreChat';
const GRACE_PERIOD_MS = 3600000;
const DUPLICATE_THRESHOLD = 0.92;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

async function createEmbedding(text, provider, model, apiKey) {
  if (provider === 'google' || provider === 'gemini') {
    if (!apiKey) {
      console.warn('[VectorizeMemories] Google API key not set, skipping embedding');
      return null;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }),
    });
    if (!response.ok) {
      console.warn(`[VectorizeMemories] Gemini embedding error ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.embedding?.values || null;
  }

  const baseURL = provider === 'openai'
    ? 'https://api.openai.com/v1'
    : provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1';

  const url = `${baseURL.replace(/\/+$/, '')}/v1/embeddings`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: text }),
  });

  if (!response.ok) {
    console.warn(`[VectorizeMemories] Embedding API error ${response.status} for ${provider}`);
    return null;
  }

  const data = await response.json();
  return data.data?.[0]?.embedding || null;
}

async function getSimilarMemory(embedding, existingMemories) {
  let best = null;
  let bestScore = 0;

  for (const mem of existingMemories) {
    if (!mem.embedding || mem.embedding.length !== embedding.length) continue;
    const score = cosineSimilarity(embedding, mem.embedding);
    if (score > bestScore) {
      bestScore = score;
      best = mem;
    }
  }

  return bestScore >= DUPLICATE_THRESHOLD ? best : null;
}

async function extractFacts(conversation) {
  const prompt = `Extract important facts about the user from this conversation.

RULES:
- Do NOT extract facts that are already covered by existing memories.
- Merge similar or related facts into one comprehensive statement.
- Each fact must be a complete, self-contained sentence.
- Return each fact as a separate line prefixed with "FACT:".
- Focus on: preferences, personal information, work/project context, skills, interests.
- If nothing new or important is learned, return "FACT: nothing".

Conversation:
${conversation}

Facts:`;

  const url = process.env.EXTRACTION_API_URL || 'http://127.0.0.1:1234/v1/chat/completions';
  const model = process.env.EXTRACTION_MODEL || 'gpt-4.1-mini';
  const apiKey = process.env.EXTRACTION_API_KEY || '';

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You extract important facts from conversations. Return only facts prefixed with FACT:, nothing else.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const isQuota = response.status === 429 || /quota|rate\s*limit/i.test(text);
    const err = new Error(`LLM API error ${response.status}: ${text.substring(0, 200)}`);
    err.isQuota = isQuota;
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('FACT:'))
    .map((l) => l.replace(/^FACT:\s*/i, '').trim())
    .filter((f) => f.length > 0 && f.toLowerCase() !== 'nothing');
}

function formatConversation(messages, convoTitle) {
  const lines = [];
  if (convoTitle) lines.push(`# ${convoTitle}`);
  for (const msg of messages) {
    const role = msg.isCreatedByUser ? 'User' : 'Assistant';
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (text) lines.push(`${role}: ${text}`);
  }
  return lines.join('\n\n');
}

function generateKey(fact, index) {
  const prefix = fact.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 50);
  return `auto_${prefix}_${index}`;
}

async function processUser(userId, personalization, Message, Conversation, MemoryEntry) {
  if (personalization?.vectorMemories === false) {
    console.log(`[VectorizeMemories] User ${userId}: vector memory disabled, skipping`);
    return;
  }

  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
  const messages = await Message.find({
    user: userId,
    createdAt: { $gte: cutoff },
    isCreatedByUser: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (messages.length === 0) {
    console.log(`[VectorizeMemories] User ${userId}: no new messages`);
    return;
  }

  const grouped = {};
  for (const msg of messages) {
    const cid = msg.conversationId?.toString() || 'unknown';
    if (!grouped[cid]) grouped[cid] = [];
    grouped[cid].push(msg);
  }

  const embedProvider = personalization?.embeddingProvider || 'google';
  const embedModel = personalization?.embeddingModel || 'text-embedding-004';
  const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

  for (const [convId, msgs] of Object.entries(grouped)) {
    let convoTitle = '';
    try {
      const convo = await Conversation.findById(convId).select('title').lean();
      convoTitle = convo?.title || '';
    } catch { }

    const dialog = formatConversation(msgs, convoTitle);
    if (dialog.length < 20) continue;

    console.log(`[VectorizeMemories] User ${userId}: extracting from conversation ${convId} (${msgs.length} msgs)`);

    let facts;
    try {
      facts = await withRetry(() => extractFacts(dialog));
    } catch (err) {
      if (err.isQuota) {
        console.warn(`[VectorizeMemories] User ${userId}: quota exceeded, will retry next cycle`);
        throw err;
      }
      console.error(`[VectorizeMemories] User ${userId}: extraction error:`, err.message);
      continue;
    }

    if (facts.length === 0) {
      console.log(`[VectorizeMemories] User ${userId}: no new facts from ${convId}`);
      continue;
    }

    const existingMemories = await MemoryEntry.find({ userId, embedding: { $exists: true, $ne: [] } })
      .select('+embedding')
      .lean();

    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      try {
        const key = generateKey(fact, i);

        const embedding = await createEmbedding(fact, embedProvider, embedModel, geminiKey);
        if (!embedding) {
          console.warn(`[VectorizeMemories] Failed to embed fact for user ${userId}, saving without embedding`);
          await MemoryEntry.findOneAndUpdate(
            { userId, key },
            { $set: { value: fact, tokenCount: Math.ceil(fact.length / 4), updated_at: new Date() } },
            { upsert: true, new: true },
          );
          continue;
        }

        const existing = await getSimilarMemory(embedding, existingMemories);
        if (existing) {
          await MemoryEntry.findByIdAndUpdate(existing._id, { $set: { updated_at: new Date() } });
          console.log(`[VectorizeMemories] Merged duplicate for user ${userId}: "${fact.substring(0, 60)}..."`);
          continue;
        }

        await MemoryEntry.findOneAndUpdate(
          { userId, key },
          {
            $set: {
              value: fact,
              tokenCount: Math.ceil(fact.length / 4),
              embedding,
              updated_at: new Date(),
            },
          },
          { upsert: true, new: true },
        );

        console.log(`[VectorizeMemories] Saved fact for user ${userId}: "${fact.substring(0, 60)}..."`);
      } catch (err) {
        console.error(`[VectorizeMemories] Error saving fact:`, err.message);
      }
    }
  }
}

async function withRetry(fn, maxRetries = 12, baseDelayMs = 120000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!err.isQuota || attempt === maxRetries) throw err;
      const delay = Math.min(Math.pow(2, attempt) * baseDelayMs, 600000);
      console.warn(`[VectorizeMemories] Quota, retry ${attempt}/${maxRetries} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
}

async function main() {
  console.log('[VectorizeMemories] Starting extraction cycle');
  console.log(`[VectorizeMemories] MongoDB: ${MONGO_URI}`);

  await mongoose.connect(MONGO_URI);

  const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({}, { strict: false }));
  const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const MemoryEntry = mongoose.models.MemoryEntry || mongoose.model('MemoryEntry', new mongoose.Schema({}, { strict: false }));

  const users = await User.find({ 'personalization.vectorMemories': { $ne: false } }).lean();
  console.log(`[VectorizeMemories] Processing ${users.length} users`);

  for (const user of users) {
    try {
      await processUser(user._id.toString(), user.personalization, Message, Conversation, MemoryEntry);
    } catch (err) {
      if (err.isQuota) {
        console.warn('[VectorizeMemories] Quota exceeded, stopping cycle early');
        break;
      }
      console.error(`[VectorizeMemories] Error processing user ${user._id}:`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log('[VectorizeMemories] Extraction cycle complete');
}

main().catch((err) => {
  console.error('[VectorizeMemories] Fatal error:', err);
  process.exit(1);
});
