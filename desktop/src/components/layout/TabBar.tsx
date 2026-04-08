import { useRef, useState, useEffect, useCallback } from 'react'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'

const TAB_WIDTH = 180

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null)
  const [closingTabId, setClosingTabId] = useState<string | null>(null)
  const t = useTranslation()

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState)
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
    }
  }, [updateScrollState, tabs.length])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: direction === 'left' ? -TAB_WIDTH : TAB_WIDTH, behavior: 'smooth' })
  }

  const handleClose = (sessionId: string) => {
    // Special tabs can always be closed directly
    const tab = tabs.find((t) => t.sessionId === sessionId)
    if (tab && tab.type !== 'session') {
      closeTab(sessionId)
      return
    }

    const sessionState = useChatStore.getState().sessions[sessionId]
    const isRunning = sessionState && sessionState.chatState !== 'idle'

    if (isRunning) {
      setClosingTabId(sessionId)
      return
    }

    disconnectSession(sessionId)
    closeTab(sessionId)
  }

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault()
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY })
  }

  const handleCloseOthers = (sessionId: string) => {
    setContextMenu(null)
    const otherIds = tabs.filter((t) => t.sessionId !== sessionId).map((t) => t.sessionId)
    for (const id of otherIds) {
      disconnectSession(id)
      closeTab(id)
    }
  }

  const handleCloseRight = (sessionId: string) => {
    setContextMenu(null)
    const idx = tabs.findIndex((t) => t.sessionId === sessionId)
    const rightIds = tabs.slice(idx + 1).map((t) => t.sessionId)
    for (const id of rightIds) {
      disconnectSession(id)
      closeTab(id)
    }
  }

  if (tabs.length === 0) return null

  return (
    <div className="flex items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] min-h-[36px] select-none">
      {canScrollLeft && (
        <button onClick={() => scroll('left')} className="flex-shrink-0 w-7 h-full flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">
          <span className="material-symbols-outlined text-[16px]">chevron_left</span>
        </button>
      )}

      <div ref={scrollRef} className="flex-1 flex overflow-x-hidden">
        {tabs.map((tab) => (
          <TabItem
            key={tab.sessionId}
            tab={tab}
            isActive={tab.sessionId === activeTabId}
            onClick={() => setActiveTab(tab.sessionId)}
            onClose={() => handleClose(tab.sessionId)}
            onContextMenu={(e) => handleContextMenu(e, tab.sessionId)}
          />
        ))}
      </div>

      {canScrollRight && (
        <button onClick={() => scroll('right')} className="flex-shrink-0 w-7 h-full flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">
          <span className="material-symbols-outlined text-[16px]">chevron_right</span>
        </button>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <button
            onClick={() => { handleClose(contextMenu.sessionId); setContextMenu(null) }}
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            {t('tabs.close')}
          </button>
          <button
            onClick={() => handleCloseOthers(contextMenu.sessionId)}
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            {t('tabs.closeOthers')}
          </button>
          <button
            onClick={() => handleCloseRight(contextMenu.sessionId)}
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            {t('tabs.closeRight')}
          </button>
        </div>
      )}

      {closingTabId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 max-w-sm w-full mx-4" style={{ boxShadow: 'var(--shadow-dropdown)' }}>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{t('tabs.closeConfirmTitle')}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">{t('tabs.closeConfirmMessage')}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setClosingTabId(null)} className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { closeTab(closingTabId); setClosingTabId(null) }}
                className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                {t('tabs.closeConfirmKeep')}
              </button>
              <button
                onClick={() => {
                  useChatStore.getState().stopGeneration(closingTabId)
                  disconnectSession(closingTabId)
                  closeTab(closingTabId)
                  setClosingTabId(null)
                }}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-brand)] text-white hover:opacity-90"
              >
                {t('tabs.closeConfirmStop')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TabItem({ tab, isActive, onClick, onClose, onContextMenu }: {
  tab: Tab
  isActive: boolean
  onClick: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`
        flex-shrink-0 flex items-center gap-1.5 px-3 h-[36px] border-r border-[var(--color-border)] cursor-pointer group transition-colors
        ${isActive
          ? 'bg-[var(--color-surface)] border-b-2 border-b-[var(--color-brand)]'
          : 'bg-[var(--color-surface-container-low)] hover:bg-[var(--color-surface-hover)]'
        }
      `}
      style={{ width: TAB_WIDTH, maxWidth: TAB_WIDTH }}
    >
      {tab.type === 'session' && tab.status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse flex-shrink-0" />
      )}
      {tab.type === 'session' && tab.status === 'error' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-error)] flex-shrink-0" />
      )}
      {tab.type === 'settings' && (
        <span className="material-symbols-outlined text-[14px] flex-shrink-0 text-[var(--color-text-tertiary)]">settings</span>
      )}
      {tab.type === 'scheduled' && (
        <span className="material-symbols-outlined text-[14px] flex-shrink-0 text-[var(--color-text-tertiary)]">schedule</span>
      )}

      <span className={`flex-1 truncate text-xs ${isActive ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-secondary)]'}`}>
        {tab.title || 'Untitled'}
      </span>

      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-hover)] transition-opacity text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  )
}
