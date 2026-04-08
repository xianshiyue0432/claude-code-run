import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MessageList, buildRenderItems } from './MessageList'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import type { UIMessage } from '../../types/chat'
import type { PerSessionState } from '../../stores/chatStore'

const ACTIVE_TAB = 'active-tab'

function makeSessionState(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
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
    ...overrides,
  }
}

describe('MessageList nested tool calls', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: ACTIVE_TAB, tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: { [ACTIVE_TAB]: makeSessionState() } })
  })

  it('renders sub-agent tool calls inline beneath the parent agent tool call', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: 'Inspect src/components' },
              timestamp: 1,
            },
            {
              id: 'tool-read',
              type: 'tool_use',
              toolName: 'Read',
              toolUseId: 'read-1',
              input: { file_path: '/tmp/example.ts' },
              timestamp: 2,
              parentToolUseId: 'agent-1',
            },
            {
              id: 'result-read',
              type: 'tool_result',
              toolUseId: 'read-1',
              content: 'const answer = 42',
              isError: false,
              timestamp: 3,
              parentToolUseId: 'agent-1',
            },
          ],
        }),
      },
    })

    const { container } = render(<MessageList />)

    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.getByText(/Read .*example\.ts.*done/i)).toBeTruthy()
    expect(container.textContent).toContain('Agent')
  })

  it('keeps root tool runs split when nested child tool calls appear between them', () => {
    const messages: UIMessage[] = [
      {
        id: 'tool-agent',
        type: 'tool_use',
        toolName: 'Agent',
        toolUseId: 'agent-1',
        input: { description: 'Inspect src/components' },
        timestamp: 1,
      },
      {
        id: 'tool-read',
        type: 'tool_use',
        toolName: 'Read',
        toolUseId: 'read-1',
        input: { file_path: '/tmp/example.ts' },
        timestamp: 2,
        parentToolUseId: 'agent-1',
      },
      {
        id: 'result-read',
        type: 'tool_result',
        toolUseId: 'read-1',
        content: 'const answer = 42',
        isError: false,
        timestamp: 3,
        parentToolUseId: 'agent-1',
      },
      {
        id: 'tool-write',
        type: 'tool_use',
        toolName: 'Write',
        toolUseId: 'write-1',
        input: { file_path: '/tmp/out.ts', content: 'export const value = 1' },
        timestamp: 4,
      },
    ]

    const toolUseIds = new Set(messages.filter((message) => message.type === 'tool_use').map((message) => message.toolUseId))
    const renderItems = buildRenderItems(messages, toolUseIds)
    const toolGroups = renderItems.filter((item) => item.kind === 'tool_group')

    expect(toolGroups).toHaveLength(2)
    expect(toolGroups.map((item) => item.toolCalls[0]?.toolUseId)).toEqual(['agent-1', 'write-1'])
  })

  it('shows failed agent status and compact unavailable summary for Explore launch errors', () => {
    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: '探索整体架构', subagent_type: 'Explore' },
              timestamp: 1,
            },
            {
              id: 'result-agent',
              type: 'tool_result',
              toolUseId: 'agent-1',
              content: `Agent type 'Explore' not found. Available agents: general-purpose`,
              isError: true,
              timestamp: 2,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Explore agent unavailable in this session')).toBeTruthy()
  })

  it('shows completed agent output when no nested tool activity is available', () => {
    const longResult = '探索完成。让我将结果整合写入计划文件。第二段补充内容用于验证 dialog 展示的是完整结果而不是截断摘要。'

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'tool-agent',
              type: 'tool_use',
              toolName: 'Agent',
              toolUseId: 'agent-1',
              input: { description: '探索整体架构' },
              timestamp: 1,
            },
            {
              id: 'result-agent',
              type: 'tool_result',
              toolUseId: 'agent-1',
              content: {
                status: 'completed',
                content: [{ type: 'text', text: longResult }],
              },
              isError: false,
              timestamp: 2,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View result' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'View result' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/第二段补充内容用于验证 dialog 展示的是完整结果而不是截断摘要。/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy()
  })

  it('renders copy controls for user messages and scopes assistant copy to a single reply', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    })

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          messages: [
            {
              id: 'user-1',
              type: 'user_text',
              content: '请帮我探索整体架构',
              timestamp: 1,
            },
            {
              id: 'assistant-1',
              type: 'assistant_text',
              content: '先看 CLI 和服务端入口。',
              timestamp: 2,
            },
            {
              id: 'assistant-2',
              type: 'assistant_text',
              content: '再看 desktop 前后端边界。',
              timestamp: 3,
            },
          ],
        }),
      },
    })

    render(<MessageList />)

    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Copy reply' })[1]!)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('再看 desktop 前后端边界。')
    })
    expect(writeText).not.toHaveBeenCalledWith(
      '先看 CLI 和服务端入口。\n再看 desktop 前后端边界。'
    )
  })
})
