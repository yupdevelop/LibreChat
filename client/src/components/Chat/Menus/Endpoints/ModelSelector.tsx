import React, { useMemo, useState, useEffect } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Settings2 } from 'lucide-react';
import { Slider, Switch, TooltipAnchor } from '@librechat/client';
import { useRecoilCallback } from 'recoil';
import store from '~/store';
import { getConfigDefaults } from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderCustomGroups,
} from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import { getSelectedIcon, getDisplayValue } from './utils';
import { CustomMenu as Menu } from './CustomMenu';
import DialogManager from './DialogManager';
import { useLocalize } from '~/hooks';

const defaultInterface = getConfigDefaults().interface;

function SummarizationThresholdPopover() {
  const localize = useLocalize();
  const [value, setValue] = useState(4096);
  const [isDefault, setIsDefault] = useState(true);
  const [isOpen, setIsOpen] = useState(false);

  const updateConversations = useRecoilCallback(({ snapshot, set }) => async (val: number | undefined) => {
    const keys = await snapshot.getPromise(store.conversationKeysAtom);
    for (const key of keys) {
      const convo = await snapshot.getPromise(store.conversationByIndex(key));
      if (convo) {
        set(store.conversationByIndex(key), { ...convo, maxContextTokens: val });
      }
    }
  },[]);

  useEffect(() => {
    const stored = localStorage.getItem('summarizationThreshold');
    const storedDefault = localStorage.getItem('summarizationThresholdDefault');
    const initValue = stored ? Number(stored) : 4096;
    const initDefault = storedDefault !== null ? storedDefault === 'true' : true;
    setValue(initValue);
    setIsDefault(initDefault);
    updateConversations(initDefault ? undefined : initValue);
  }, [updateConversations]);

  const handleValueChange = (newVals: number[]) => {
    const val = newVals[0];
    setValue(val);
    localStorage.setItem('summarizationThreshold', val.toString());
    updateConversations(val);
  };

  const handleDefaultChange = (checked: boolean) => {
    setIsDefault(checked);
    localStorage.setItem('summarizationThresholdDefault', checked.toString());
    updateConversations(checked ? undefined : value);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger asChild>
        <TooltipAnchor
          description={localize('com_ui_summarization_threshold')}
          role="button"
          tabIndex={0}
          aria-label={localize('com_ui_summarization_threshold')}
          className="inline-flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-border-light bg-presentation text-text-primary transition-all ease-in-out hover:bg-surface-tertiary disabled:pointer-events-none disabled:opacity-50 radix-state-open:bg-surface-tertiary"
        >
          <Settings2 className="icon-sm" aria-hidden="true" />
        </TooltipAnchor>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          className="z-[100] w-64 rounded-md border border-border-light bg-white p-4 shadow-xl dark:bg-gray-700 dark:text-white"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                {localize('com_ui_use_default')}
              </label>
              <Switch
                checked={isDefault}
                onCheckedChange={handleDefaultChange}
                className="shrink-0"
              />
            </div>
            {!isDefault && (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between text-sm">
                  <span>{localize('com_ui_threshold')}:</span>
                  <span className="font-semibold">{value}</span>
                </div>
                <Slider
                  value={[value]}
                  min={0}
                  max={256000}
                  step={4096}
                  onValueChange={handleValueChange}
                  className="flex h-4 w-full"
                />
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelSelectorContent() {
  const localize = useLocalize();

  const {
    // LibreChat
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    // State
    searchValue,
    searchResults,
    selectedValues,
    // Functions
    setSearchValue,
    setSelectedValues,
    // Dialog
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig],
  );
  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );

  const trigger = (
    <TooltipAnchor
      aria-label={localize('com_ui_select_model')}
      description={localize('com_ui_select_model')}
      render={
        <button
          className="my-1 flex h-9 w-full max-w-[70vw] items-center justify-center gap-2 rounded-xl border border-border-light bg-presentation px-3 py-2 text-sm text-text-primary hover:bg-surface-active-alt"
          aria-label={localize('com_ui_select_model')}
        >
          {selectedIcon && React.isValidElement(selectedIcon) && (
            <div className="flex flex-shrink-0 items-center justify-center overflow-hidden">
              {selectedIcon}
            </div>
          )}
          <span className="flex-grow truncate text-left">{selectedDisplayValue}</span>
        </button>
      }
    />
  );

  return (
    <div className="flex w-full items-center gap-2">
      <div className="relative flex w-full max-w-md flex-col items-center gap-2">
        <Menu
          values={selectedValues}
        onValuesChange={(values: Record<string, any>) => {
          setSelectedValues({
            endpoint: values.endpoint || '',
            model: values.model || '',
            modelSpec: values.modelSpec || '',
          });
        }}
        onSearch={(value) => setSearchValue(value)}
        combobox={<input id="model-search" placeholder=" " />}
        comboboxLabel={localize('com_endpoint_search_models')}
        trigger={trigger}
      >
        {searchResults ? (
          renderSearchResults(searchResults, localize, searchValue)
        ) : (
          <>
            {/* Render ungrouped modelSpecs (no group field) */}
            {renderModelSpecs(
              modelSpecs?.filter((spec) => !spec.group) || [],
              selectedValues.modelSpec || '',
            )}
            {/* Render endpoints (will include grouped specs matching endpoint names) */}
            {renderEndpoints(mappedEndpoints ?? [])}
            {/* Render custom groups (specs with group field not matching any endpoint) */}
            {renderCustomGroups(modelSpecs || [], mappedEndpoints ?? [])}
          </>
        )}
      </Menu>
        <DialogManager
          keyDialogOpen={keyDialogOpen}
          onOpenChange={onOpenChange}
          endpointsConfig={endpointsConfig || {}}
          keyDialogEndpoint={keyDialogEndpoint || undefined}
        />
      </div>
      <SummarizationThresholdPopover />
    </div>
  );
}

export default function ModelSelector({ startupConfig }: ModelSelectorProps) {
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  // Hide the selector when modelSelect is false and there are no model specs to show
  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
