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
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/LibreChat';
const GRACE_PERIOD_MS = 3600000;
const DUPLICATE_THRESHOLD = 0.92;
const stats = {
  usersProcessed: 0,
  usersSkippedNoMessages: 0,
  usersSkippedSettings: 0,
  conversationsProcessed: 0,
  conversationsSkippedShort: 0,
  extractionCalls: 0,
  factsExtracted: 0,
  factsSaved: 0,
  factsSavedWithoutEmbedding: 0,
  duplicateFacts: 0,
  extractionErrors: 0,
};

let _cachedConfig = null;
function loadLibreChatConfig() {
  if (_cachedConfig) return _cachedConfig;
  const configPath = process.env.CONFIG_PATH || path.join(__dirname, '..', '..', 'librechat.yaml');
  const raw = fs.readFileSync(configPath, 'utf8');
  _cachedConfig = yaml.load(raw);
  return _cachedConfig;
}

function resolveEmbeddingEndpoint(provider) {
  const config = loadLibreChatConfig();
  const customEp = (config?.endpoints?.custom || [])
    .find((ep) => ep.name?.toLowerCase?.() === provider.toLowerCase());
  if (!customEp) return null;
  const resolveVar = (val) => {
    if (!val || typeof val !== 'string') return val;
    return val.replace(/\${([^}]+)}/g, (_, name) => process.env[name] || '');
  };
  const resolvedApiKey = resolveVar(customEp.apiKey);
  return {
    baseURL: resolveVar(customEp.baseURL),
    apiKey: resolvedApiKey && !resolvedApiKey.startsWith('$') ? resolvedApiKey : undefined,
  };
}

function getOpenAICompatibleUrl(baseURL, pathName) {
  const normalizedBaseURL = baseURL.replace(/\/+$/, '');
  const normalizedPath = pathName.replace(/^\/+/, '');
  return normalizedBaseURL.endsWith('/v1')
    ? `${normalizedBaseURL}/${normalizedPath}`
    : `${normalizedBaseURL}/v1/${normalizedPath}`;
}

function resolveCustomEndpoint(provider) {
  const config = loadLibreChatConfig();
  return (config?.endpoints?.custom || [])
    .find((ep) => ep.name?.toLowerCase?.() === provider.toLowerCase());
}

function resolveEndpointConfig(provider) {
  if (provider === 'google' || provider === 'gemini') {
    const apiKey = process.env.GOOGLE_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    const baseURL = process.env.GOOGLE_REVERSE_PROXY || 'https://generativelanguage.googleapis.com';
    return {
      baseURL,
      apiKey: apiKey === 'user_provided' ? '' : apiKey,
      nativeGoogle: true,
    };
  }

  const customEp = resolveCustomEndpoint(provider);
  if (!customEp) return null;
  const resolveVar = (val) => {
    if (!val || typeof val !== 'string') return val;
    return val.replace(/\${([^}]+)}/g, (_, name) => process.env[name] || '');
  };
  const resolvedApiKey = resolveVar(customEp.apiKey);
  return {
    baseURL: resolveVar(customEp.baseURL),
    apiKey: resolvedApiKey && !resolvedApiKey.startsWith('$') ? resolvedApiKey : undefined,
  };
}

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

async function createEmbedding(text, provider, model, apiKey, embedBaseURL) {
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
      : embedBaseURL || process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1';

  const url = getOpenAICompatibleUrl(baseURL, 'embeddings');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: text }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`[VectorizeMemories] Embedding API error ${response.status} for ${provider}: ${text.substring(0, 500)}`);
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

async function extractFacts(conversation, provider, model, apiKey, baseURL) {
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

  if (!provider || !model) {
    throw new Error('Extraction provider and model are required in user Personalization settings');
  }

  if (provider === 'google' || provider === 'gemini') {
    return extractFactsWithGoogle(provider, model, apiKey, baseURL, prompt);
  }

  const url = getOpenAICompatibleUrl(baseURL, 'chat/completions');

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  stats.extractionCalls += 1;
  console.log(`[VectorizeMemories] Calling extraction LLM provider=${provider} model=${model} url=${url}`);

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

  if (!content.trim()) {
    throw new Error(`Extraction model returned empty content for provider=${provider} model=${model}`);
  }

  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('FACT:'))
    .map((l) => l.replace(/^FACT:\s*/i, '').trim())
    .filter((f) => f.length > 0 && f.toLowerCase() !== 'nothing');
}

async function extractFactsWithGoogle(provider, model, apiKey, baseURL, prompt) {
  if (!apiKey) {
    throw new Error(`Google API key is required for cron extraction provider=${provider}`);
  }

  const normalizedBaseURL = baseURL.replace(/\/+$/, '');
  const url = `${normalizedBaseURL}/v1beta/models/${model}:generateContent`;
  stats.extractionCalls += 1;
  console.log(`[VectorizeMemories] Calling Google extraction LLM provider=${provider} model=${model} url=${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: 'You extract important facts from conversations. Return only facts prefixed with FACT:, nothing else.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const isQuota = response.status === 429 || /quota|rate\s*limit/i.test(text);
    const err = new Error(`Google LLM API error ${response.status}: ${text.substring(0, 200)}`);
    err.isQuota = isQuota;
    throw err;
  }

  const data = await response.json();
  const content = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n');

  if (!content.trim()) {
    throw new Error(`Google extraction model returned empty content for provider=${provider} model=${model}`);
  }

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
    const text = typeof msg.text === 'string' ? msg.text : typeof msg.content === 'string' ? msg.content : '';
    if (text) lines.push(`${role}: ${text}`);
  }
  return lines.join('\n\n');
}

function generateKey(fact, index) {
  const prefix = fact.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 50);
  return `auto_${prefix}_${index}`;
}

async function processUser(userId, personalization, Message, Conversation, MemoryEntry) {
  stats.usersProcessed += 1;
  if (personalization?.vectorMemories === false) {
    console.log(`[VectorizeMemories] User ${userId}: vector memory disabled, skipping`);
    return;
  }

  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
  console.log(`[VectorizeMemories] User ${userId}: scanning messages since ${cutoff.toISOString()}`);
  const messages = await Message.find({
    user: userId,
    createdAt: { $gte: cutoff },
    isCreatedByUser: true,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (messages.length === 0) {
    stats.usersSkippedNoMessages += 1;
    console.log(`[VectorizeMemories] User ${userId}: no new messages`);
    return;
  }

  console.log(`[VectorizeMemories] User ${userId}: found ${messages.length} user messages`);

  const grouped = {};
  for (const msg of messages) {
    const cid = msg.conversationId?.toString() || 'unknown';
    if (!grouped[cid]) grouped[cid] = [];
    grouped[cid].push(msg);
  }

  const extractionProvider = personalization?.extractionProvider || '';
  const extractionModel = personalization?.extractionModel || '';
  const embedProvider = personalization?.embeddingProvider || '';
  const embedModel = personalization?.embeddingModel || '';

  console.log(`[VectorizeMemories] User ${userId}: personalization extraction=${extractionProvider || '<empty>'}/${extractionModel || '<empty>'}, embedding=${embedProvider || '<empty>'}/${embedModel || '<empty>'}`);

  if (!extractionProvider || !extractionModel || !embedProvider || !embedModel) {
    stats.usersSkippedSettings += 1;
    console.warn(`[VectorizeMemories] User ${userId}: missing Personalization settings, skipping`, {
      extractionProvider: extractionProvider || null,
      extractionModel: extractionModel || null,
      embeddingProvider: embedProvider || null,
      embeddingModel: embedModel || null,
    });
    return;
  }

  const extractionCfg = resolveEndpointConfig(extractionProvider);
  const embedCfg = embedProvider === 'google' || embedProvider === 'gemini'
    ? { apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '', baseURL: undefined }
    : resolveEmbeddingEndpoint(embedProvider);

  if (!extractionCfg?.baseURL) {
    stats.usersSkippedSettings += 1;
    console.warn(`[VectorizeMemories] User ${userId}: extraction endpoint "${extractionProvider}" not found in librechat.yaml, skipping`);
    return;
  }

  console.log(`[VectorizeMemories] User ${userId}: resolved extraction baseURL=${extractionCfg.baseURL}, hasApiKey=${Boolean(extractionCfg.apiKey)}, embeddingBaseURL=${embedCfg?.baseURL || '<default>'}, hasEmbeddingApiKey=${Boolean(embedCfg?.apiKey)}`);

  if (!embedCfg?.apiKey) {
    console.warn(`[VectorizeMemories] User ${userId}: embedding API key missing for provider "${embedProvider}"`);
  }

  for (const [convId, msgs] of Object.entries(grouped)) {
    let convoTitle = '';
    try {
      const convo = await Conversation.findById(convId).select('title').lean();
      convoTitle = convo?.title || '';
    } catch { }

    const dialog = formatConversation(msgs, convoTitle);
    if (dialog.length < 20) {
      stats.conversationsSkippedShort += 1;
      console.log(`[VectorizeMemories] User ${userId}: conversation ${convId} skipped, dialog too short (${dialog.length} chars)`);
      continue;
    }

    stats.conversationsProcessed += 1;
    console.log(`[VectorizeMemories] User ${userId}: extracting from conversation ${convId} (${msgs.length} msgs)`);

    let facts;
    try {
      facts = await withRetry(() => extractFacts(
        dialog,
        extractionProvider,
        extractionModel,
        extractionCfg.apiKey,
        extractionCfg.baseURL,
      ));
    } catch (err) {
      if (err.isQuota) {
        console.warn(`[VectorizeMemories] User ${userId}: quota exceeded, will retry next cycle`);
        throw err;
      }
      stats.extractionErrors += 1;
      console.error(`[VectorizeMemories] User ${userId}: extraction error:`, err.message);
      continue;
    }

    if (facts.length === 0) {
      console.log(`[VectorizeMemories] User ${userId}: no new facts from ${convId}`);
      continue;
    }

    stats.factsExtracted += facts.length;
    console.log(`[VectorizeMemories] User ${userId}: extracted ${facts.length} facts from ${convId}`);

    const existingMemories = await MemoryEntry.find({ userId, embedding: { $exists: true, $ne: [] } })
      .select('+embedding')
      .lean();

    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      try {
        const key = generateKey(fact, i);

        const embedding = await createEmbedding(fact, embedProvider, embedModel, embedCfg?.apiKey, embedCfg?.baseURL);
        if (!embedding) {
          console.warn(`[VectorizeMemories] Failed to embed fact for user ${userId}, saving without embedding`);
          await MemoryEntry.findOneAndUpdate(
            { userId, key },
            { $set: { value: fact, tokenCount: Math.ceil(fact.length / 4), updated_at: new Date() } },
            { upsert: true, new: true },
          );
          stats.factsSavedWithoutEmbedding += 1;
          continue;
        }

        const existing = await getSimilarMemory(embedding, existingMemories);
        if (existing) {
          await MemoryEntry.findByIdAndUpdate(existing._id, { $set: { updated_at: new Date() } });
          stats.duplicateFacts += 1;
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

        stats.factsSaved += 1;
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
  console.log(`[VectorizeMemories] Summary: ${JSON.stringify(stats)}`);
  console.log('[VectorizeMemories] Extraction cycle complete');
}

main().catch((err) => {
  console.error('[VectorizeMemories] Fatal error:', err);
  process.exit(1);
});
