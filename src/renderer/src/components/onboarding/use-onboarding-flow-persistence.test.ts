// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const trackMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry', () => ({
  track: trackMock
}))

import {
  buildCompletedOnboardingNotificationSettings,
  onboardingChatPermissionSetting
} from './use-onboarding-flow-persistence'

describe('onboarding flow persistence', () => {
  beforeEach(() => {
    trackMock.mockClear()
  })

  it('preserves explicit focus notification suppression when completing onboarding', () => {
    const notifications = buildCompletedOnboardingNotificationSettings({
      enabled: false,
      agentTaskComplete: false,
      subagentTaskComplete: false,
      terminalBell: false,
      suppressWhenFocused: false,
      customSoundId: 'two-tone',
      customSoundPath: null,
      customSoundVolume: 60,
      mutedNotificationSourceIds: [],
      notifyHiddenWorkspaces: false
    })

    expect(notifications).toEqual({
      enabled: true,
      agentTaskComplete: true,
      subagentTaskComplete: false,
      terminalBell: true,
      suppressWhenFocused: false,
      customSoundId: 'two-tone',
      customSoundPath: null,
      customSoundVolume: 60,
      mutedNotificationSourceIds: [],
      notifyHiddenWorkspaces: false
    })
  })

  it('sets new chats from a flipped Yolo mode, keeping a custom mode and an untouched replay', () => {
    const set = (mode: string) => ({ nativeChatPermissionMode: mode })
    expect(onboardingChatPermissionSetting('full-access', false, true)).toEqual(set('ask'))
    expect(onboardingChatPermissionSetting('ask', true, true)).toEqual(set('full-access'))
    expect(onboardingChatPermissionSetting('ask', true, false)).toEqual({})
    expect(onboardingChatPermissionSetting('auto', false, true)).toEqual({})
  })
})
