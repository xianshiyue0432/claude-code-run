import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

// Import all pages
import { EmptySession } from '../pages/EmptySession'
import { ActiveSession } from '../pages/ActiveSession'
import { AgentTeams } from '../pages/AgentTeams'
import { AgentTranscript } from '../pages/AgentTranscript'
import { ScheduledTasks } from '../pages/ScheduledTasks'
import { ToolInspection } from '../pages/ToolInspection'

// Layout components (chrome is now here, not in pages)
import { AppShell } from '../components/layout/AppShell'
import { Sidebar } from '../components/layout/Sidebar'
import { UserMessage } from '../components/chat/UserMessage'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'

/**
 * Core rendering tests: content-only pages must render without crashing
 * and contain key structural elements from the prototype.
 */
describe('Content-only pages render without errors', () => {
  it('EmptySession renders mascot and composer', () => {
    const { container } = render(<EmptySession />)
    expect(container.querySelector('textarea')).toBeInTheDocument()
    expect(container.innerHTML).toContain('New session')
    expect(container.innerHTML).toContain('Ask anything')
  })

  it('EmptySession plus menu exposes uploads and slash commands before chat starts', () => {
    render(<EmptySession />)
    fireEvent.click(screen.getByRole('button', { name: 'Open composer tools' }))
    expect(screen.getByText('Add files or photos')).toBeInTheDocument()
    expect(screen.getByText('Slash commands')).toBeInTheDocument()
  })

  it('ActiveSession renders with chat components', () => {
    const SESSION_ID = 'test-active-session'
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          elapsedTimer: null,
        },
      },
    })
    const { container } = render(<ActiveSession />)
    // Should have the title area and chat input
    expect(container.innerHTML).toContain('Untitled Session')
    // ChatInput has a textarea
    expect(container.querySelector('textarea')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('Preview')
    // Cleanup
    useTabStore.setState({ tabs: [], activeTabId: null })
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession shows a single primary action button while a turn is active', () => {
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          elapsedTimer: null,
        },
      },
    })
    render(<ActiveSession />)

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    useChatStore.setState({ sessions: {} })
  })

  it('AgentTeams renders team strip and members', () => {
    const { container } = render(<AgentTeams />)
    expect(container.innerHTML).toContain('Architect')
    expect(container.innerHTML).toContain('session-dev')
    expect(container.innerHTML).toContain('groups')
  })

  it('AgentTranscript renders transcript content', () => {
    const { container } = render(<AgentTranscript />)
    expect(container.innerHTML).toContain('Frontend Dev')
    expect(container.innerHTML).toContain('Back to Leader')
    expect(container.innerHTML).toContain('Navigation.tsx')
  })

  it('ScheduledTasks renders (store-connected)', async () => {
    const { container } = render(<ScheduledTasks />)
    await screen.findByText('Scheduled tasks')
    expect(container.innerHTML).toContain('Scheduled tasks')
  })

  it('ToolInspection renders diff viewer', () => {
    const { container } = render(<ToolInspection />)
    expect(container.innerHTML).toContain('edit_file')
    expect(container.innerHTML).toContain('Split')
    expect(container.innerHTML).toContain('Unified')
  })
})

describe('Chat attachments', () => {
  it('UserMessage opens image gallery when an attachment is clicked', () => {
    render(
      <UserMessage
        content=""
        attachments={[
          {
            type: 'image',
            name: 'diagram.png',
            data: 'data:image/png;base64,abc123',
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('diagram.png')).toBeInTheDocument()
  })
})

describe('AppShell layout renders chrome', () => {
  it('AppShell renders sidebar and session shell', () => {
    const { container } = render(<Sidebar />)
    expect(container.querySelector('aside')).toBeInTheDocument()
    expect(container.innerHTML).toContain('New session')
    expect(container.innerHTML).toContain('Scheduled')
    expect(container.innerHTML).toContain('All projects')
  })
})

describe('Design system compliance', () => {
  it('Pages use Material Symbols Outlined icons', () => {
    const pages = [EmptySession, AgentTeams, AgentTranscript, ToolInspection]
    for (const Page of pages) {
      const { container, unmount } = render(<Page />)
      const icons = container.querySelectorAll('.material-symbols-outlined')
      expect(icons.length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('Current brand color is used in content pages', () => {
    const pages = [EmptySession]
    for (const Page of pages) {
      const { container, unmount } = render(<Page />)
      const html = container.innerHTML
      expect(
        html.includes('C47A5A') ||
        html.includes('8F482F') ||
        html.includes('var(--color-brand)') ||
        html.includes('bg-[var(--color-brand)]'),
      ).toBe(true)
      unmount()
    }
  })
})

describe('Mock data integration', () => {
  it('AgentTeams shows team members from mock data', () => {
    const { container } = render(<AgentTeams />)
    expect(container.innerHTML).toContain('Architect')
    expect(container.innerHTML).toContain('Frontend Dev')
    expect(container.innerHTML).toContain('Backend Dev')
    expect(container.innerHTML).toContain('Tester')
  })

  it('AgentTranscript shows transcript content', () => {
    const { container } = render(<AgentTranscript />)
    expect(container.innerHTML).toContain('Navigation.tsx')
  })
})
