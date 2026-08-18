import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { NotesSendMenu, type NotesSendMenuScope } from './NotesSendMenu'
import { buildEditorSelectionAgentPrompt } from './editor-selection-agent-prompt'
import type { MonacoMarkdownSelectionAnnotationTarget } from './monaco-markdown-selection-annotation'

type AskAgentSelectionPopoverProps = {
  target: MonacoMarkdownSelectionAnnotationTarget
  worktreeId: string
  relativePath: string
  language: string
  onClose: () => void
}

type SelectionNote = { selectedText: string }

export function AskAgentSelectionPopover({
  target,
  worktreeId,
  relativePath,
  language,
  onClose
}: AskAgentSelectionPopoverProps): React.JSX.Element {
  const groupId = useAppStore((s) => s.activeGroupIdByWorktree[worktreeId]) ?? worktreeId
  const [question, setQuestion] = useState('')
  const [openRequestNonce, setOpenRequestNonce] = useState<number | null>(null)
  const questionRef = useRef(question)
  questionRef.current = question
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const labelId = useId()

  const startLine = target.startLine ?? target.lineNumber
  const endLine = target.lineNumber
  const prompt = useMemo(
    () =>
      buildEditorSelectionAgentPrompt({
        question,
        relativePath,
        startLine,
        endLine,
        language,
        selectedText: target.selectedText
      }),
    [question, relativePath, startLine, endLine, language, target.selectedText]
  )
  const scopes = useMemo<NotesSendMenuScope<SelectionNote>[]>(
    () => [
      {
        id: 'selection',
        label: translate(
          'auto.components.editor.AskAgentSelectionPopover.scopeLabel',
          'Code selection'
        ),
        notes: [{ selectedText: target.selectedText }],
        prompt
      }
    ],
    [prompt, target.selectedText]
  )

  // Why: Monaco doesn't bubble React clicks, so outside-dismiss needs a
  // document-level listener; a typed question soft-blocks the dismissal.
  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent): void => {
      if (!popoverRef.current || popoverRef.current.contains(event.target as Node)) {
        return
      }
      // The send dropdown renders in a portal outside the popover subtree.
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) {
        return
      }
      if (/\S/u.test(questionRef.current)) {
        return
      }
      onCloseRef.current()
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [])

  const autoResize = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  return (
    <div
      ref={popoverRef}
      className="orca-diff-comment-popover"
      style={{
        top: `${Math.max(4, target.top)}px`,
        ...(target.left == null ? {} : { left: `${target.left}px` })
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="orca-diff-comment-content-col" style={{ gap: '8px' }}>
        <div id={labelId} className="orca-diff-comment-popover-label">
          {endLine !== startLine
            ? translate(
                'auto.components.editor.AskAgentSelectionPopover.titleRange',
                'Ask agent about lines {{value0}}-{{value1}}',
                { value0: startLine, value1: endLine }
              )
            : translate(
                'auto.components.editor.AskAgentSelectionPopover.titleLine',
                'Ask agent about line {{value0}}',
                { value0: endLine }
              )}
        </div>
        <textarea
          ref={(textarea) => textarea?.focus()}
          className="orca-diff-comment-popover-textarea"
          placeholder={translate(
            'auto.components.editor.AskAgentSelectionPopover.placeholder',
            'Ask a question about this code (optional)'
          )}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value)
            autoResize(event.currentTarget)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.shiftKey) {
              event.preventDefault()
              setOpenRequestNonce(Date.now())
            }
          }}
          rows={2}
        />
        <div className="orca-diff-comment-popover-footer">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {translate('auto.components.editor.AskAgentSelectionPopover.cancel', 'Cancel')}
          </Button>
          <NotesSendMenu<SelectionNote>
            worktreeId={worktreeId}
            groupId={groupId}
            modeIdParts={[
              'editor-selection',
              worktreeId,
              relativePath,
              String(startLine),
              String(endLine)
            ]}
            scopes={scopes}
            source="editor-selection"
            targetModeLabel={translate(
              'auto.components.editor.AskAgentSelectionPopover.scopeLabel',
              'Code selection'
            )}
            triggerClassName="h-8 gap-1.5 rounded-md border border-border bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
            actionLabel={translate(
              'auto.components.editor.AskAgentSelectionPopover.send',
              'Send to agent'
            )}
            align="end"
            openRequestNonce={openRequestNonce}
            onOpenRequestHandled={() => setOpenRequestNonce(null)}
            onDelivered={() => onCloseRef.current()}
          />
        </div>
      </div>
    </div>
  )
}
