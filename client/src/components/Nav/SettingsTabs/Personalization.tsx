import { useState, useEffect } from 'react';
import { Switch, useToastContext } from '@librechat/client';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { EModelEndpoint, alternateName } from 'librechat-data-provider';
import {
  useGetUserQuery,
  useUpdateMemoryPreferencesMutation,
  useUpdateVectorMemoryPreferencesMutation,
  useExtractMemoryMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface PersonalizationProps {
  hasMemoryOptOut: boolean;
  hasAnyPersonalizationFeature: boolean;
}

const NON_CHAT_ENDPOINTS = new Set([
  EModelEndpoint.assistants,
  EModelEndpoint.azureAssistants,
  EModelEndpoint.agents,
]);

function getChatModels(modelsData: Record<string, string[]> | undefined): string[] {
  if (!modelsData) {
    return [];
  }

  const chatModels = new Set<string>();
  for (const [endpoint, models] of Object.entries(modelsData)) {
    if (NON_CHAT_ENDPOINTS.has(endpoint as EModelEndpoint)) {
      continue;
    }
    if (Array.isArray(models)) {
      for (const model of models) {
        chatModels.add(model);
      }
    }
  }
  return Array.from(chatModels).sort();
}

function getProviders(modelsData: Record<string, string[]> | undefined): Array<{ label: string; value: string }> {
  if (!modelsData) {
    return [];
  }

  const providers: Array<{ label: string; value: string }> = [];
  for (const [endpoint] of Object.entries(modelsData)) {
    if (NON_CHAT_ENDPOINTS.has(endpoint as EModelEndpoint)) {
      continue;
    }
    const label = alternateName[endpoint as EModelEndpoint] || endpoint;
    providers.push({ label, value: endpoint });
  }
  return providers;
}

function getEmbeddingModels(modelsData: Record<string, string[]> | undefined): Array<{ label: string; value: string }> {
  if (!modelsData) {
    return [];
  }

  const embeddingModels = new Set<string>();
  for (const models of Object.values(modelsData)) {
    if (Array.isArray(models)) {
      for (const model of models) {
        if (model.toLowerCase().includes('embedding')) {
          embeddingModels.add(model);
        }
      }
    }
  }
  return Array.from(embeddingModels).map((m) => ({ label: m, value: m }));
}

export default function Personalization({
  hasMemoryOptOut,
  hasAnyPersonalizationFeature,
}: PersonalizationProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const { data: modelsData } = useGetModelsQuery();
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

  const extractMemoryMutation = useExtractMemoryMutation({
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

  const extractionModels = getChatModels(modelsData);
  const providers = getProviders(modelsData);
  const embeddingModels = getEmbeddingModels(modelsData);

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
              <div className="text-sm font-medium mt-2">{localize('com_ui_embedding')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{localize('com_ui_provider')}</label>
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
                    {providers.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{localize('com_ui_model')}</label>
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
                    {embeddingModels.length > 0 ? (
                      embeddingModels.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))
                    ) : (
                      <option value="">{localize('com_ui_no_embedding_models')}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Extraction Configuration */}
              <div className="text-sm font-medium mt-3">{localize('com_ui_extraction')}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{localize('com_ui_provider')}</label>
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
                    <option value="">{localize('com_ui_same_as_chat')}</option>
                    {providers.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{localize('com_ui_model')}</label>
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
                    <option value="">{localize('com_ui_auto')}</option>
                    {extractionModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Manual Extract Button */}
              <div className="mt-4">
                <button
                  className="px-4 py-2 text-sm text-text-primary bg-surface-primary border border-border-medium rounded hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => extractMemoryMutation.mutate(20)}
                  disabled={extractMemoryMutation.isLoading || !vectorMemories}
                >
                  {extractMemoryMutation.isLoading
                    ? localize('com_ui_extracting')
                    : localize('com_ui_extract_now')}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
