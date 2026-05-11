import { Tokenizer } from '@librechat/api';
import type { TMessage } from 'librechat-data-provider';

/**
 * Trims messages to fit within token limit.
 * Priority: remove assistant messages first (oldest first), then user messages (oldest first).
 * @param messages - Array of messages to trim
 * @param maxTokens - Maximum token limit
 * @returns Trimmed array of messages with token counts
 */
export function trimMessagesToTokenLimit(
  messages: TMessage[],
  maxTokens: number,
): TMessage[] {
  if (messages.length === 0) {
    return [];
  }

  // Sort by createdAt (oldest first)
  const sorted = [...messages].sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateA - dateB;
  });

  // Calculate initial token count
  let totalTokens = 0;
  const messagesWithTokens = sorted.map((msg) => {
    const content = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
    const tokenCount = Tokenizer.getTokenCount(content, 'o200k_base');
    totalTokens += tokenCount;
    return { message: msg, tokenCount };
  });

  if (totalTokens <= maxTokens) {
    return sorted;
  }

  // Separate assistant and user/other messages
  const assistantMessages = messagesWithTokens.filter(
    (item) => item.message.role === 'assistant' || item.message.isCreatedByUser === true,
  );
  const otherMessages = messagesWithTokens.filter(
    (item) => item.message.role !== 'assistant' || item.message.isCreatedByUser !== true,
  );

  // Start with all messages and remove oldest first by priority
  const remaining = [...messagesWithTokens];
  let currentTokens = totalTokens;

  // Remove assistant messages first (oldest first)
  for (const item of assistantMessages) {
    if (currentTokens <= maxTokens) {
      break;
    }
    const index = remaining.findIndex((r) => r.message.messageId === item.message.messageId);
    if (index !== -1) {
      currentTokens -= remaining[index].tokenCount;
      remaining.splice(index, 1);
    }
  }

  // Remove user/other messages (oldest first)
  for (const item of otherMessages) {
    if (currentTokens <= maxTokens) {
      break;
    }
    const index = remaining.findIndex((r) => r.message.messageId === item.message.messageId);
    if (index !== -1) {
      currentTokens -= remaining[index].tokenCount;
      remaining.splice(index, 1);
    }
  }

  return remaining.map((item) => item.message);
}
