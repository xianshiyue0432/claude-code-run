import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'

export function StatusBar() {
  const { currentModel } = useSettingsStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)

  const activeSession = sessions.find((s) => s.id === activeTabId)

  const projectName = activeSession?.projectPath
    ? activeSession.projectPath.split('-').filter(Boolean).pop() || ''
    : ''

  return (
    <div className="h-[var(--statusbar-height)] flex items-center justify-between px-4 border-t border-[var(--color-border)] bg-[var(--color-surface-sidebar)] select-none text-[11px]">
      <div className="flex items-center gap-3">
        {projectName && (
          <span className="text-[var(--color-text-secondary)] font-[var(--font-mono)]">{projectName}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {currentModel && (
          <span className="text-[var(--color-text-tertiary)] font-[var(--font-mono)]">
            {currentModel.name}
          </span>
        )}
      </div>
    </div>
  )
}
