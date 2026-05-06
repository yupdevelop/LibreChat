import { useMemo, useState, useCallback, memo } from 'react';
import { useAuthContext } from '~/hooks';
import { useMessagesOperations } from '~/Providers';
import type { TFile, TMessage } from 'librechat-data-provider';
import FileContainer from '~/components/Chat/Input/Files/FileContainer';
import FilePreviewDialog from './FilePreviewDialog';
import Image from './Image';

const Files = ({ message }: { message?: TMessage }) => {
  const { token } = useAuthContext();
  const { getMessages, setMessages } = useMessagesOperations();
  const { conversationId } = message ?? {};

  const imageFiles = useMemo(() => {
    return message?.files?.filter((file) => file.type?.startsWith('image/')) || [];
  }, [message?.files]);

  const otherFiles = useMemo(() => {
    return message?.files?.filter((file) => !file.type?.startsWith('image/')) || [];
  }, [message?.files]);

  const [selectedFile, setSelectedFile] = useState<Partial<TFile> | null>(null);

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      setSelectedFile(null);
    }
  }, []);

  const handleDeleteImage = useCallback(async (fileId: string) => {
    if (!conversationId || !message?.messageId) return;

    try {
      const currentMessages = getMessages() || [];
      const updatedMessages = currentMessages.map((m) => {
        if (m.messageId === message?.messageId) {
          return {
            ...m,
            files: m.files?.filter((f) => f.file_id !== fileId),
          };
        }
        return m;
      });

      setMessages(updatedMessages);

      const res = await fetch(`/api/messages/${conversationId}/${message?.messageId}/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        setMessages(currentMessages);
        throw new Error('Failed to delete image');
      }
    } catch (err) {
      console.error('Error deleting image:', err);
    }
  }, [conversationId, message?.messageId, getMessages, setMessages, token]);

  return (
    <>
      {otherFiles.length > 0 &&
        otherFiles.map((file) => (
          <FileContainer
            key={file.file_id}
            file={file as TFile}
            onClick={() => setSelectedFile(file)}
          />
        ))}
      {imageFiles.length > 0 &&
        imageFiles.map((file) => (
          <Image
            key={file.file_id}
            imagePath={file.preview ?? file.filepath ?? ''}
            height={file.height ?? 1920}
            width={file.width ?? 1080}
            altText={file.filename ?? 'Uploaded Image'}
            onDelete={() => handleDeleteImage(file.file_id!)}
          />
        ))}
      <FilePreviewDialog
        open={selectedFile !== null}
        onOpenChange={handleClose}
        fileName={selectedFile?.filename ?? ''}
        fileId={selectedFile?.file_id}
        fileType={selectedFile?.type ?? undefined}
        fileSize={(selectedFile as TFile)?.bytes}
      />
    </>
  );
};

export default memo(Files);
