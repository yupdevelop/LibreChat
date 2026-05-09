import axios from 'axios';
import { logger } from '@librechat/data-schemas';

export interface EmbeddingOptions {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

const embeddingCache = new Map<string, { embedding: number[]; expires: number }>();

const CACHE_TTL_QUERY = 5 * 60 * 1000;
const CACHE_TTL_FACT = 60 * 60 * 1000;

function cacheKey(text: string, provider: string, model: string): string {
  return `${provider}:${model}:${text}`;
}

function getCached(key: string): number[] | null {
  const entry = embeddingCache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.embedding;
  }
  embeddingCache.delete(key);
  return null;
}

function setCache(key: string, embedding: number[], isQuery: boolean): void {
  const ttl = isQuery ? CACHE_TTL_QUERY : CACHE_TTL_FACT;
  embeddingCache.set(key, { embedding, expires: Date.now() + ttl });
  if (embeddingCache.size > 10000) {
    const now = Date.now();
    for (const [k, v] of embeddingCache) {
      if (v.expires < now) embeddingCache.delete(k);
    }
  }
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function embedGemini(
  text: string,
  model: string,
  apiKey: string,
): Promise<number[]> {
  const url = `${GEMINI_BASE}/models/${model}:embedContent`;
  const response = await axios.post(
    url,
    {
      model: `models/${model}`,
      content: { parts: [{ text }] },
    },
    {
      headers: { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );

  const values = response.data?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error(`Unexpected Gemini embedding response: ${JSON.stringify(response.data)}`);
  }
  return values;
}

async function embedOpenAICompatible(
  text: string,
  model: string,
  apiKey: string | undefined,
  baseURL: string,
): Promise<number[]> {
  const url = `${baseURL.replace(/\/+$/, '')}/v1/embeddings`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await axios.post(
    url,
    { model, input: text },
    { headers, timeout: 15000 },
  );

  const embedding = response.data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error(`Unexpected OpenAI-compatible embedding response: ${JSON.stringify(response.data)}`);
  }
  return embedding;
}

export async function createEmbedding(
  text: string,
  options: EmbeddingOptions,
): Promise<number[] | null> {
  try {
    const key = cacheKey(text, options.provider, options.model);
    const cached = getCached(key);
    if (cached) return cached;

    let embedding: number[];

    if (options.provider === 'google' || options.provider === 'gemini') {
      if (!options.apiKey) {
        throw new Error('Gemini API key is required for Google embeddings');
      }
      embedding = await embedGemini(text, options.model || 'text-embedding-004', options.apiKey);
    } else {
      const baseURL = options.baseURL || 'https://api.openai.com/v1';
      embedding = await embedOpenAICompatible(text, options.model, options.apiKey, baseURL);
    }

    setCache(key, embedding, true);
    return embedding;
  } catch (error) {
    logger.error(
      `[EmbeddingsService] Failed to create embedding (provider=${options.provider}, model=${options.model}):`,
      error,
    );
    return null;
  }
}

export async function createEmbeddings(
  texts: string[],
  options: EmbeddingOptions,
): Promise<(number[] | null)[]> {
  return Promise.all(texts.map((text) => createEmbedding(text, options)));
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}
