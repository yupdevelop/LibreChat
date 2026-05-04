import React, { useState, useId, useMemo, useCallback, useEffect } from 'react';
import {
  Input,
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import { useMoveConversationFolderMutation } from '~/data-provider';
import { useConversationFoldersQuery } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const NEW_FOLDER_VALUE = '__new__';
const NO_FOLDER_VALUE = '__none__';

type MoveToFolderDialogProps = {
  conversationId: string;
  currentFolder?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
  onMoved?: () => void;
};

function getInitialSelection(currentFolder?: string | null): string {
  return currentFolder ? currentFolder : NO_FOLDER_VALUE;
}

export default function MoveToFolderDialog({
  conversationId,
  currentFolder,
  open,
  onOpenChange,
  triggerRef,
  onMoved,
}: MoveToFolderDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const radioGroupId = useId();
  const newFolderInputId = useId();

  const { data: folders = [] } = useConversationFoldersQuery({ enabled: open });
  const moveMutation = useMoveConversationFolderMutation();

  const [selection, setSelection] = useState<string>(getInitialSelection(currentFolder));
  const [newFolderName, setNewFolderName] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSelection(getInitialSelection(currentFolder));
      setNewFolderName('');
    }
  }, [open, currentFolder]);

  const trimmedNewFolder = newFolderName.trim();
  const isCreatingNew = selection === NEW_FOLDER_VALUE;
  const targetFolder: string | null = useMemo(() => {
    if (selection === NO_FOLDER_VALUE) {
      return null;
    }
    if (selection === NEW_FOLDER_VALUE) {
      return trimmedNewFolder || null;
    }
    return selection;
  }, [selection, trimmedNewFolder]);

  const isUnchanged =
    (currentFolder ?? null) === targetFolder && !(isCreatingNew && trimmedNewFolder.length > 0);
  const submitDisabled =
    moveMutation.isLoading ||
    (isCreatingNew && trimmedNewFolder.length === 0) ||
    isUnchanged;

  const handleSubmit = useCallback(() => {
    if (submitDisabled) {
      return;
    }
    moveMutation.mutate(
      { conversationId, folder: targetFolder },
      {
        onSuccess: () => {
          onOpenChange(false);
          onMoved?.();
        },
        onError: () => {
          showToast({
            message: localize('com_ui_move_to_folder_error'),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          });
        },
      },
    );
  }, [
    submitDisabled,
    moveMutation,
    conversationId,
    targetFolder,
    onOpenChange,
    onMoved,
    showToast,
    localize,
  ]);

  const radioOptionClass =
    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary hover:bg-surface-hover';

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent className="w-11/12 max-w-md" aria-describedby="move-to-folder-description">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_move_to_folder')}</OGDialogTitle>
        </OGDialogHeader>
        <div id="move-to-folder-description" className="sr-only">
          {localize('com_ui_move_to_folder')}
        </div>
        <div
          role="radiogroup"
          aria-labelledby={`${radioGroupId}-label`}
          className="flex max-h-72 flex-col gap-1 overflow-y-auto"
        >
          <span id={`${radioGroupId}-label`} className="sr-only">
            {localize('com_ui_folder')}
          </span>
          <label className={radioOptionClass}>
            <input
              type="radio"
              name={radioGroupId}
              value={NO_FOLDER_VALUE}
              checked={selection === NO_FOLDER_VALUE}
              onChange={() => setSelection(NO_FOLDER_VALUE)}
              className="h-4 w-4 accent-text-primary"
            />
            <span>{localize('com_ui_no_folder')}</span>
          </label>
          {folders.map((name) => (
            <label key={name} className={radioOptionClass}>
              <input
                type="radio"
                name={radioGroupId}
                value={name}
                checked={selection === name}
                onChange={() => setSelection(name)}
                className="h-4 w-4 accent-text-primary"
              />
              <span className="truncate">{name}</span>
            </label>
          ))}
          <label className={radioOptionClass}>
            <input
              type="radio"
              name={radioGroupId}
              value={NEW_FOLDER_VALUE}
              checked={isCreatingNew}
              onChange={() => setSelection(NEW_FOLDER_VALUE)}
              className="h-4 w-4 accent-text-primary"
            />
            <span>{localize('com_ui_new_folder')}</span>
          </label>
        </div>
        <div className={cn('mt-2', !isCreatingNew && 'pointer-events-none opacity-50')}>
          <label htmlFor={newFolderInputId} className="sr-only">
            {localize('com_ui_folder_name_placeholder')}
          </label>
          <Input
            id={newFolderInputId}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onFocus={() => setSelection(NEW_FOLDER_VALUE)}
            placeholder={localize('com_ui_folder_name_placeholder')}
            maxLength={100}
            disabled={!isCreatingNew}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitDisabled) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </div>
        <div className="flex justify-end gap-4 pt-4">
          <OGDialogClose asChild>
            <Button aria-label={localize('com_ui_cancel')} variant="outline">
              {localize('com_ui_cancel')}
            </Button>
          </OGDialogClose>
          <Button onClick={handleSubmit} disabled={submitDisabled}>
            {moveMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
