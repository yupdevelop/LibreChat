import React, { useState, useMemo, memo } from 'react';
import { useRecoilState } from 'recoil';
import type { TConversation, TMessage, TFeedback } from 'librechat-data-provider';
import { EditIcon, Clipboard, CheckMark, ContinueIcon, RegenerateIcon, TrashIcon } from '@librechat/client';
import { useGenerationsByLatest, useLocalize, useAuthContext } from '~/hooks';
import { useMessagesOperations, useMessagesState } from '~/Providers';
import { Fork } from '~/components/Conversations';
import MessageAudio from './MessageAudio';
import Feedback from './Feedback';
import { cn } from '~/utils';
import store from '~/store';

type THoverButtons = {
  isEditing: boolean;
  enterEdit: (cancel?: boolean) => void;
  copyToClipboard: (setIsCopied: React.Dispatch<React.SetStateAction<boolean>>) => void;
  conversation: TConversation | null;
  isSubmitting: boolean;
  message: TMessage;
  regenerate: () => void;
  handleContinue: (e: React.MouseEvent<HTMLButtonElement>) => void;
  latestMessageId?: string;
  isLast: boolean;
  index: number;
  handleFeedback?: ({ feedback }: { feedback: TFeedback | undefined }) => void;
};

type HoverButtonProps = {
  id?: string;
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  icon: React.ReactNode;
  isActive?: boolean;
  isVisible?: boolean;
  isDisabled?: boolean;
  isLast?: boolean;
  className?: string;
  buttonStyle?: string;
};

const extractMessageContent = (message: TMessage): string => {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part == null) {
          return '';
        }
        if (typeof part === 'string') {
          return part;
        }
        if ('text' in part) {
          return part.text || '';
        }
        if ('think' in part) {
          const think = part.think;
          if (typeof think === 'string') {
            return think;
          }
          return think && 'text' in think ? think.text || '' : '';
        }
        return '';
      })
      .join('');
  }

  return message.text || '';
};

const HoverButton = memo(
  ({
    id,
    onClick,
    title,
    icon,
    isActive = false,
    isVisible = true,
    isDisabled = false,
    isLast = false,
    className = '',
  }: HoverButtonProps) => {
    const buttonStyle = cn(
      'hover-button rounded-lg p-1.5 text-text-secondary-alt',
      'hover:text-text-primary hover:bg-surface-hover',
      'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
      !isLast && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
      !isVisible && 'opacity-0',
      'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
      isActive && isVisible && 'active text-text-primary bg-surface-hover',
      className,
    );

    return (
      <button
        id={id}
        className={buttonStyle}
        onClick={onClick}
        type="button"
        title={title}
        disabled={isDisabled}
      >
        {icon}
      </button>
    );
  },
);

HoverButton.displayName = 'HoverButton';

const HoverButtons = ({
  index,
  isEditing,
  enterEdit,
  copyToClipboard,
  conversation,
  isSubmitting,
  message,
  regenerate,
  handleContinue,
  latestMessageId,
  isLast,
  handleFeedback,
}: THoverButtons) => {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [isCopied, setIsCopied] = useState(false);
  const [TextToSpeech] = useRecoilState<boolean>(store.textToSpeech);

  const endpoint = useMemo(() => {
    if (!conversation) {
      return '';
    }
    return conversation.endpointType ?? conversation.endpoint;
  }, [conversation]);

  const generationCapabilities = useGenerationsByLatest({
    isEditing,
    isSubmitting,
    error: message.error,
    endpoint: endpoint ?? '',
    messageId: message.messageId,
    searchResult: message.searchResult,
    finish_reason: message.finish_reason,
    isCreatedByUser: message.isCreatedByUser,
    latestMessageId: latestMessageId,
  });

  const {
    hideEditButton,
    regenerateEnabled,
    continueSupported,
    forkingSupported,
    isEditableEndpoint,
  } = generationCapabilities;

  if (!conversation) {
    return null;
  }

  const { getMessages, setMessages } = useMessagesOperations();
  const { setLatestMessage } = useMessagesState();
  const { isCreatedByUser, error } = message;

  const handleDelete = async () => {
    if (!conversation) {
      return;
    }
    let currentMessagesSnapshot: TMessage[] = [];
    try {
      const currentMessages = getMessages() || [];
      currentMessagesSnapshot = [...currentMessages];
      const findNearestSurvivingLatest = (messages: TMessage[], startId?: string | null) => {
        let currentId = startId ?? null;
        const visited = new Set<string>();

        while (currentId) {
          if (visited.has(currentId)) {
            break;
          }
          visited.add(currentId);

          const candidate = messages.find((m) => m.messageId === currentId);
          if (candidate) {
            return candidate;
          }

          const deletedMessage = currentMessagesSnapshot.find((m) => m.messageId === currentId);
          currentId = deletedMessage?.parentMessageId ?? null;
        }

        return messages[messages.length - 1] ?? null;
      };

      let userMessage = message;

      if (!message.isCreatedByUser) {
        const parent = currentMessages.find((m) => m.messageId === message.parentMessageId);
        if (parent) {
          userMessage = parent;
        }
      }

      const idsToDelete = new Set<string>([userMessage.messageId]);
      const assistantResponses = currentMessages.filter(
        (m) => m.parentMessageId === userMessage.messageId,
      );
      assistantResponses.forEach((r) => idsToDelete.add(r.messageId));

      const newParentId = userMessage.parentMessageId;
      const orphans = currentMessages.filter(
        (m) => idsToDelete.has(m.parentMessageId ?? '') && !idsToDelete.has(m.messageId),
      );

      const newMessages = currentMessages
        .filter((m) => !idsToDelete.has(m.messageId))
        .map((m) => {
          if (orphans.some((o) => o.messageId === m.messageId)) {
            return { ...m, parentMessageId: newParentId };
          }
          return m;
        });

      setMessages(newMessages);

      const shouldRepointLatest =
        latestMessageId != null &&
        (idsToDelete.has(latestMessageId) || idsToDelete.has(message.messageId));

      if (shouldRepointLatest) {
        const nextLatest = findNearestSurvivingLatest(newMessages, latestMessageId);
        setLatestMessage(nextLatest);
      }

      await Promise.all(
        orphans.map((o) =>
          fetch(`/api/messages/${conversation.conversationId}/${o.messageId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ parentMessageId: newParentId }),
          }),
        ),
      );

      await Promise.all(
        Array.from(idsToDelete).map((id) =>
          fetch(`/api/messages/${conversation.conversationId}/${id}`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          }),
        ),
      );
    } catch (err) {
      if (currentMessagesSnapshot.length > 0) {
        setMessages(currentMessagesSnapshot);
      }
      console.error('Error deleting message turn:', err);
    }
  };

  const isLastMessagePair = () => {
    const currentMessages = getMessages() || [];
    if (currentMessages.length === 0) return true;

    let userMessageCount = 0;
    currentMessages.forEach((msg) => {
      if (msg.isCreatedByUser) {
        const hasResponse = currentMessages.some((m) => m.parentMessageId === msg.messageId);
        if (hasResponse) {
          userMessageCount++;
        }
      }
    });

    return userMessageCount <= 1;
  };

  const canDelete = !isLastMessagePair();

  if (error === true) {
    return (
      <div className="visible flex justify-center self-end lg:justify-start">
        {canDelete && (
          <HoverButton
            onClick={handleDelete}
            title={localize('com_ui_delete')}
            icon={<TrashIcon className="h-[18px] w-[18px]" />}
            isDisabled={isSubmitting}
            isLast={isLast}
          />
        )}
        {regenerateEnabled && (
          <HoverButton
            onClick={regenerate}
            title={localize('com_ui_regenerate')}
            icon={<RegenerateIcon size="19" />}
            isLast={isLast}
          />
        )}
      </div>
    );
  }

  const onEdit = () => {
    if (isEditing) {
      return enterEdit(true);
    }
    enterEdit();
  };

  const handleCopy = () => copyToClipboard(setIsCopied);

  return (
    <div className="group visible flex justify-center gap-0.5 self-end focus-within:outline-none lg:justify-start">
      {/* Text to Speech */}
      {TextToSpeech && (
        <MessageAudio
          index={index}
          isLast={isLast}
          messageId={message.messageId}
          content={extractMessageContent(message)}
          renderButton={(props) => (
            <HoverButton
              onClick={props.onClick}
              title={props.title}
              icon={props.icon}
              isActive={props.isActive}
              isLast={isLast}
            />
          )}
        />
      )}

      {/* Copy Button */}
      <HoverButton
        onClick={handleCopy}
        title={
          isCopied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy_to_clipboard')
        }
        icon={isCopied ? <CheckMark className="h-[18px] w-[18px]" /> : <Clipboard size="19" />}
        isLast={isLast}
        className={cn(
          'ml-0 flex items-center gap-1.5 text-xs',
          isSubmitting && isCreatedByUser ? 'md:opacity-0 md:group-hover:opacity-100' : '',
        )}
      />

      {/* Edit Button */}
      {isEditableEndpoint && (
        <HoverButton
          id={`edit-${message.messageId}`}
          onClick={onEdit}
          title={localize('com_ui_edit')}
          icon={<EditIcon size="19" />}
          isActive={isEditing}
          isVisible={!hideEditButton}
          isDisabled={hideEditButton}
          isLast={isLast}
          className={isCreatedByUser ? '' : 'active'}
        />
      )}

      {/* Fork Button */}
      <Fork
        messageId={message.messageId}
        conversationId={conversation.conversationId}
        forkingSupported={forkingSupported}
        latestMessageId={latestMessageId}
        isLast={isLast}
      />

      {/* Feedback Buttons */}
      {!isCreatedByUser && handleFeedback != null && (
        <Feedback handleFeedback={handleFeedback} feedback={message.feedback} isLast={isLast} />
      )}

      {/* Regenerate Button */}
      {regenerateEnabled && (
        <HoverButton
          onClick={regenerate}
          title={localize('com_ui_regenerate')}
          icon={<RegenerateIcon size="19" />}
          isLast={isLast}
          className="active"
        />
      )}

      {/* Continue Button */}
      {continueSupported && (
        <HoverButton
          onClick={(e) => e && handleContinue(e)}
          title={localize('com_ui_continue')}
          icon={<ContinueIcon className="w-19 h-19 -rotate-180" />}
          isLast={isLast}
          className="active"
        />
      )}

      {/* Delete Button */}
      {canDelete && (
        <HoverButton
          onClick={handleDelete}
          title={localize('com_ui_delete')}
          icon={<TrashIcon className="h-[18px] w-[18px]" />}
          isDisabled={isSubmitting}
          isLast={isLast}
        />
      )}
    </div>
  );
};

export default memo(HoverButtons);
