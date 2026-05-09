import { useState, useEffect } from 'react';
import { Switch, useToastContext } from '@librechat/client';
import {
  useGetUserQuery,
  useUpdateMemoryPreferencesMutation,
  useUpdateVectorMemoryPreferencesMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface PersonalizationProps {
  hasMemoryOptOut: boolean;
  hasAnyPersonalizationFeature: boolean;
}

const MODELS = [
  { label: 'text-embedding-004', value: 'text-embedding-004' },
  { label: 'text-embedding-3-small', value: 'text-embedding-3-small' },
  { label: 'text-embedding-3-large', value: 'text-embedding-3-large' },
  { label: 'nomic-embed-text-v1.5', value: 'nomic-embed-text-v1.5' },
];

const PROVIDERS = [
  { label: 'Google Gemini', value: 'google' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'LM Studio', value: 'lm-studio' },
];

export default function Personalization({
  hasMemoryOptOut,
  hasAnyPersonalizationFeature,
}: PersonalizationProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);
  const [vectorMemories, setVectorMemories] = useState(true);
  const [embeddingProvider, setEmbeddingProvider] = useState('google');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-004');
  const [extractionProvider, setExtractionProvider] = useState('');
  const [extractionModel, setExtractionModel] = useState('');

  const updateMemoryPreferencesMutation = useUpdateMemoryPreferencesMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      setReferenceSavedMemories((prev) => !prev);
    },
  });

  const updateVectorMemoryMutation = useUpdateVectorMemoryPreferencesMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
    },
  });

  useEffect(() => {
    if (user?.personalization?.memories !== undefined) {
      setReferenceSavedMemories(user.personalization.memories);
    }
    if (user?.personalization?.vectorMemories !== undefined) {
      setVectorMemories(user.personalization.vectorMemories);
    }
    if (user?.personalization?.embeddingProvider) {
      setEmbeddingProvider(user.personalization.embeddingProvider);
    }
    if (user?.personalization?.embeddingModel) {
      setEmbeddingModel(user.personalization.embeddingModel);
    }
    if (user?.personalization?.extractionProvider !== undefined) {
      setExtractionProvider(user.personalization.extractionProvider);
    }
    if (user?.personalization?.extractionModel !== undefined) {
      setExtractionModel(user.personalization.extractionModel);
    }
  }, [
    user?.personalization?.memories,
    user?.personalization?.vectorMemories,
    user?.personalization?.embeddingProvider,
    user?.personalization?.embeddingModel,
    user?.personalization?.extractionProvider,
    user?.personalization?.extractionModel,
  ]);

  const handleMemoryToggle = (checked: boolean) => {
    setReferenceSavedMemories(checked);
    updateMemoryPreferencesMutation.mutate({ memories: checked });
  };

  const handleVectorMemoryToggle = (checked: boolean) => {
    setVectorMemories(checked);
    updateVectorMemoryMutation.mutate({
      vectorMemories: checked,
      embeddingProvider,
      embeddingModel,
      extractionProvider,
      extractionModel,
    });
  };

  if (!hasAnyPersonalizationFeature) {
    return (
      <div className="flex flex-col gap-3 text-sm text-text-primary">
        <div className="text-text-secondary">{localize('com_ui_no_personalization_available')}</div>
      </div>
    );
  }

  const embeddingModels = MODELS;
  const extractionModels = MODELS;

  return (
    <div className="flex flex-col gap-3 text-sm text-text-primary">
      {/* Memory Settings Section */}
      {hasMemoryOptOut && (
        <>
          <div className="border-b border-border-medium pb-3">
            <div className="text-base font-semibold">{localize('com_ui_memory')}</div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div id="reference-saved-memories-label" className="flex items-center gap-2">
                {localize('com_ui_reference_saved_memories')}
              </div>
              <div
                id="reference-saved-memories-description"
                className="mt-1 text-xs text-text-secondary"
              >
                {localize('com_ui_reference_saved_memories_description')}
              </div>
            </div>
            <Switch
              checked={referenceSavedMemories}
              onCheckedChange={handleMemoryToggle}
              disabled={updateMemoryPreferencesMutation.isLoading}
              aria-labelledby="reference-saved-memories-label"
              aria-describedby="reference-saved-memories-description"
            />
          </div>

          {/* Vector Memory Settings */}
          <div className="mt-4 border-b border-border-medium pb-3">
            <div className="text-base font-semibold">Vector Memory</div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div id="vector-memory-label" className="flex items-center gap-2">
                Vector Memory
              </div>
              <div
                id="vector-memory-description"
                className="mt-1 text-xs text-text-secondary"
              >
                Enable semantic vector search for more relevant memory retrieval
              </div>
            </div>
            <Switch
              checked={vectorMemories}
              onCheckedChange={handleVectorMemoryToggle}
              disabled={updateVectorMemoryMutation.isLoading}
              aria-labelledby="vector-memory-label"
              aria-describedby="vector-memory-description"
            />
          </div>

          {vectorMemories && (
            <>
              {/* Embedding Configuration */}
              <div className="text-sm font-medium mt-2">Embedding</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Provider</label>
                  <select
                    className="w-full rounded border border-border-medium bg-surface-secondary px-2 py-1.5 text-sm"
                    value={embeddingProvider}
                    onChange={(e) => {
                      const newProvider = e.target.value;
                      setEmbeddingProvider(newProvider);
                      updateVectorMemoryMutation.mutate({
                        vectorMemories,
                        embeddingProvider: newProvider,
                        embeddingModel,
                        extractionProvider,
                        extractionModel,
                      });
                    }}
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Model</label>
                  <select
                    className="w-full rounded border border-border-medium bg-surface-secondary px-2 py-1.5 text-sm"
                    value={embeddingModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setEmbeddingModel(newModel);
                      updateVectorMemoryMutation.mutate({
                        vectorMemories,
                        embeddingProvider,
                        embeddingModel: newModel,
                        extractionProvider,
                        extractionModel,
                      });
                    }}
                  >
                    {embeddingModels.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Extraction Configuration */}
              <div className="text-sm font-medium mt-3">Extraction</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Provider</label>
                  <select
                    className="w-full rounded border border-border-medium bg-surface-secondary px-2 py-1.5 text-sm"
                    value={extractionProvider}
                    onChange={(e) => {
                      const newProvider = e.target.value;
                      setExtractionProvider(newProvider);
                      updateVectorMemoryMutation.mutate({
                        vectorMemories,
                        embeddingProvider,
                        embeddingModel,
                        extractionProvider: newProvider,
                        extractionModel,
                      });
                    }}
                  >
                    <option value="">Same as chat</option>
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Model</label>
                  <select
                    className="w-full rounded border border-border-medium bg-surface-secondary px-2 py-1.5 text-sm"
                    value={extractionModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setExtractionModel(newModel);
                      updateVectorMemoryMutation.mutate({
                        vectorMemories,
                        embeddingProvider,
                        embeddingModel,
                        extractionProvider,
                        extractionModel: newModel,
                      });
                    }}
                  >
                    <option value="">Auto</option>
                    {extractionModels.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
