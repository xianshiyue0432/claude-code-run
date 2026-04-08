import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useTranslation } from '../i18n'
import { Modal } from '../components/shared/Modal'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import type { PermissionMode, EffortLevel } from '../types/settings'
import type { Locale } from '../i18n'
import { PROVIDER_PRESETS } from '../config/providerPresets'
import type { ProviderPreset } from '../config/providerPresets'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping } from '../types/provider'
import { AdapterSettings } from './AdapterSettings'

type SettingsTab = 'providers' | 'permissions' | 'general' | 'adapters'

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers')
  const t = useTranslation()

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <div className="flex-1 flex overflow-hidden">
        {/* Tab navigation */}
        <div className="w-48 border-r border-[var(--color-border)] py-3 flex-shrink-0">
          <TabButton icon="dns" label={t('settings.tab.providers')} active={activeTab === 'providers'} onClick={() => setActiveTab('providers')} />
          <TabButton icon="shield" label={t('settings.tab.permissions')} active={activeTab === 'permissions'} onClick={() => setActiveTab('permissions')} />
          <TabButton icon="tune" label={t('settings.tab.general')} active={activeTab === 'general'} onClick={() => setActiveTab('general')} />
          <TabButton icon="chat" label={t('settings.tab.adapters')} active={activeTab === 'adapters'} onClick={() => setActiveTab('adapters')} />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'providers' && <ProviderSettings />}
          {activeTab === 'permissions' && <PermissionSettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'adapters' && <AdapterSettings />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] font-medium'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {label}
    </button>
  )
}

// ─── Provider Settings ──────────────────────────────────────

function ProviderSettings() {
  const { providers, activeId, isLoading, fetchProviders, deleteProvider, activateProvider, activateOfficial, testProvider } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    if (!window.confirm(t('settings.providers.confirmDelete', { name: provider.name }))) return
    await deleteProvider(provider.id).catch(console.error)
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { success: false, latencyMs: 0, error: t('settings.providers.requestFailed') } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const handleActivateOfficial = async () => {
    await activateOfficial()
    await fetchSettings()
  }

  const isOfficialActive = activeId === null

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.providers.title')}</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">{t('settings.providers.description')}</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t('settings.providers.addProvider')}
        </Button>
      </div>

      {/* Official provider — always visible at top */}
      <div
        className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all mb-2 ${
          isOfficialActive
            ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] cursor-pointer'
        }`}
        onClick={() => !isOfficialActive && handleActivateOfficial()}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOfficialActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('settings.providers.officialName')}</span>
            {isOfficialActive && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">{t('common.active')}</span>
            )}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{t('settings.providers.officialDesc')}</div>
        </div>
      </div>

      {/* Saved providers */}
      {isLoading && providers.length === 0 ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = PROVIDER_PRESETS.find((p) => p.id === provider.presetId)
            return (
              <div
                key={provider.id}
                className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all group ${
                  isActive
                    ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{provider.name}</span>
                    {preset && preset.id !== 'custom' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">{preset.name}</span>
                    )}
                    {isActive && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">{t('common.active')}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
                    {provider.baseUrl} &middot; {provider.models.main}
                  </div>
                  {test && !test.loading && test.result && (
                    <div className={`text-xs mt-1 ${test.result.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                      {test.result.success ? t('settings.providers.connected', { latency: String(test.result.latencyMs) }) : t('settings.providers.failed', { error: test.result.error || '' })}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(provider.id)}>{t('settings.providers.activate')}</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>{t('settings.providers.test')}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)}>{t('settings.providers.edit')}</Button>
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">{t('common.delete')}</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal — conditionally rendered so state resets on close */}
      {showCreateModal && (
        <ProviderFormModal open={true} onClose={() => setShowCreateModal(false)} mode="create" />
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} />
      )}
    </div>
  )
}

// ─── Provider Form Modal ──────────────────────────────────────

type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
}

function requirePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error('Provider presets are not configured')
  }
  return preset
}

function ProviderFormModal({ open, onClose, mode, provider }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const t = useTranslation()

  const availablePresets = PROVIDER_PRESETS.filter((p) => p.id !== 'official')
  const fallbackPreset = requirePreset(
    availablePresets[availablePresets.length - 1] ?? PROVIDER_PRESETS[0],
  )
  const initialPreset = requirePreset(
    provider
      ? availablePresets.find((p) => p.id === provider.presetId) ?? fallbackPreset
      : availablePresets[0] ?? fallbackPreset,
  )

  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset>(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [settingsJson, setSettingsJson] = useState('')
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(null)
  const jsonPastedRef = useRef(false)

  // Load current settings.json and merge provider env vars
  useEffect(() => {
    // Skip if JSON was just populated by user paste
    if (jsonPastedRef.current) {
      jsonPastedRef.current = false
      return
    }
    import('../api/settings').then(({ settingsApi }) => {
      settingsApi.getUser().then((settings) => {
        const merged = {
          ...settings,
          env: {
            ...((settings.env as Record<string, string>) || {}),
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_AUTH_TOKEN: apiKey || '(your API key)',
            ANTHROPIC_MODEL: models.main,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haiku,
            ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnet,
            ANTHROPIC_DEFAULT_OPUS_MODEL: models.opus,
          },
        }
        setSettingsJson(JSON.stringify(merged, null, 2))
      }).catch(() => {
        setSettingsJson(JSON.stringify({}, null, 2))
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset.id])

  const handlePresetChange = (preset: ProviderPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setModels({ ...preset.defaultModels })
    setTestResult(null)
  }

  const isCustom = selectedPreset.id === 'custom'
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || apiKey.trim()) && models.main.trim() && !settingsJsonError

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      // Write the edited settings.json first (for all presets including official)
      if (settingsJson.trim()) {
        try {
          const parsed = JSON.parse(settingsJson)
          const { settingsApi } = await import('../api/settings')
          await settingsApi.updateUser(parsed)
        } catch {
          // JSON validation already prevents this
        }
      }

      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          models,
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          models,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
      }
      await fetchSettings()
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id)
      } else {
        if (!apiKey.trim()) return
        result = await testConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: models.main.trim() })
      }
      setTestResult(result)
    } catch {
      setTestResult({ success: false, latencyMs: 0, error: t('settings.providers.requestFailed') })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? t('settings.providers.addTitle') : t('settings.providers.editTitle')}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? t('common.add') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset chips */}
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.preset')}</label>
            <div className="flex flex-wrap gap-2">
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                    selectedPreset.id === preset.id
                      ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)]'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Input label={t('settings.providers.name')} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providers.namePlaceholder')} />

        <Input label={t('settings.providers.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('settings.providers.notesPlaceholder')} />

        {/* Base URL */}
        {isCustom || mode === 'edit' ? (
          <Input label={t('settings.providers.baseUrl')} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.providers.baseUrlPlaceholder')} />
        ) : (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">{t('settings.providers.baseUrl')}</label>
            <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
              {baseUrl}
            </div>
          </div>
        )}

        <Input
          label={mode === 'edit' ? t('settings.providers.apiKeyKeep') : t('settings.providers.apiKey')}
          required={mode === 'create'}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={mode === 'edit' ? '****' : 'sk-...'}
        />

        {/* Model Mapping */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.modelMapping')}</label>
          <div className="grid grid-cols-2 gap-2">
            <Input label={t('settings.providers.mainModel')} required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
            <Input label={t('settings.providers.haikuModel')} value={models.haiku} onChange={(e) => setModels({ ...models, haiku: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.sonnetModel')} value={models.sonnet} onChange={(e) => setModels({ ...models, sonnet: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
            <Input label={t('settings.providers.opusModel')} value={models.opus} onChange={(e) => setModels({ ...models, opus: e.target.value })} placeholder={t('settings.providers.sameAsMain')} />
          </div>
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models.main.trim()}>
            {t('settings.providers.testConnection')}
          </Button>
          {testResult && (
            <span className={`text-xs ${testResult.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {testResult.success ? t('settings.providers.connected', { latency: String(testResult.latencyMs) }) : t('settings.providers.failed', { error: testResult.error || '' })}
            </span>
          )}
        </div>

        {/* Settings JSON — editable, shown for all presets including official */}
        <div>
          <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">{t('settings.providers.settingsJson')}</label>
          <textarea
            value={settingsJson}
            onChange={(e) => {
              const raw = e.target.value
              setSettingsJson(raw)
              try {
                const parsed = JSON.parse(raw)
                setSettingsJsonError(null)
                // Auto-fill form fields from parsed JSON env
                const env = parsed.env as Record<string, string> | undefined
                if (env) {
                  if (env.ANTHROPIC_BASE_URL) {
                    setBaseUrl(env.ANTHROPIC_BASE_URL)
                    // Auto-switch to matching preset or Custom
                    if (mode === 'create') {
                      const matchedPreset = availablePresets.find((p) => p.id !== 'custom' && p.baseUrl === env.ANTHROPIC_BASE_URL)
                      const targetPreset = requirePreset(
                        matchedPreset ?? availablePresets.find((p) => p.id === 'custom'),
                      )
                      if (targetPreset.id !== selectedPreset.id) {
                        jsonPastedRef.current = true
                        setSelectedPreset(targetPreset)
                      }
                    }
                  }
                  if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_AUTH_TOKEN !== '(your API key)') setApiKey(env.ANTHROPIC_AUTH_TOKEN)
                  const newModels: Partial<ModelMapping> = {}
                  if (env.ANTHROPIC_MODEL) newModels.main = env.ANTHROPIC_MODEL
                  if (env.ANTHROPIC_DEFAULT_HAIKU_MODEL) newModels.haiku = env.ANTHROPIC_DEFAULT_HAIKU_MODEL
                  if (env.ANTHROPIC_DEFAULT_SONNET_MODEL) newModels.sonnet = env.ANTHROPIC_DEFAULT_SONNET_MODEL
                  if (env.ANTHROPIC_DEFAULT_OPUS_MODEL) newModels.opus = env.ANTHROPIC_DEFAULT_OPUS_MODEL
                  if (Object.keys(newModels).length > 0) {
                    setModels((prev) => ({ ...prev, ...newModels }))
                  }
                }
              } catch (err) {
                setSettingsJsonError(err instanceof Error ? err.message : 'Invalid JSON')
              }
            }}
            rows={16}
            spellCheck={false}
            className={`w-full text-xs px-3 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border font-mono leading-relaxed resize-y text-[var(--color-text-secondary)] outline-none ${
              settingsJsonError
                ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                : 'border-[var(--color-border)] focus:border-[var(--color-border-focus)]'
            }`}
          />
          {settingsJsonError && (
            <p className="text-[11px] text-[var(--color-error)] mt-1">{t('settings.providers.jsonError', { error: settingsJsonError })}</p>
          )}
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('settings.providers.settingsJsonDesc')}</p>
        </div>
      </div>
    </Modal>
  )
}


// ─── Permission Settings ──────────────────────────────────────

function PermissionSettings() {
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const t = useTranslation()

  const MODES: Array<{ mode: PermissionMode; icon: string; label: string; desc: string }> = [
    { mode: 'default', icon: 'verified_user', label: t('settings.permissions.default'), desc: t('settings.permissions.defaultDesc') },
    { mode: 'acceptEdits', icon: 'edit_note', label: t('settings.permissions.acceptEdits'), desc: t('settings.permissions.acceptEditsDesc') },
    { mode: 'plan', icon: 'architecture', label: t('settings.permissions.plan'), desc: t('settings.permissions.planDesc') },
    { mode: 'bypassPermissions', icon: 'bolt', label: t('settings.permissions.bypass'), desc: t('settings.permissions.bypassDesc') },
  ]

  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.permissions.title')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-4">{t('settings.permissions.description')}</p>

      <div className="flex flex-col gap-2">
        {MODES.map(({ mode, icon, label, desc }) => {
          const isSelected = permissionMode === mode
          return (
            <button
              key={mode}
              onClick={() => setPermissionMode(mode)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isSelected
                  ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] text-[var(--color-text-secondary)]">{icon}</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">{desc}</div>
              </div>
              {isSelected && (
                <span className="material-symbols-outlined text-[18px] text-[var(--color-brand)]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── General Settings ──────────────────────────────────────

function GeneralSettings() {
  const { effortLevel, setEffort, locale, setLocale } = useSettingsStore()
  const t = useTranslation()

  const EFFORT_LABELS: Record<EffortLevel, string> = {
    low: t('settings.general.effort.low'),
    medium: t('settings.general.effort.medium'),
    high: t('settings.general.effort.high'),
    max: t('settings.general.effort.max'),
  }

  const LANGUAGES: Array<{ value: Locale; label: string }> = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ]

  return (
    <div className="max-w-xl">
      {/* Language selector */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.languageTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.languageDescription')}</p>
      <div className="flex gap-2 mb-8">
        {LANGUAGES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setLocale(value)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              locale === value
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Effort Level */}
      <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{t('settings.general.effortTitle')}</h2>
      <p className="text-sm text-[var(--color-text-tertiary)] mb-3">{t('settings.general.effortDescription')}</p>
      <div className="flex gap-2">
        {(['low', 'medium', 'high', 'max'] as EffortLevel[]).map((level) => (
          <button
            key={level}
            onClick={() => setEffort(level)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
              effortLevel === level
                ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {EFFORT_LABELS[level]}
          </button>
        ))}
      </div>
    </div>
  )
}
