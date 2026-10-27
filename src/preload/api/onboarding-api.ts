import type { NativeChatUpgradeTipVariant } from '../../shared/native-chat-upgrade-tip-audience'
import type { OnboardingState } from '../../shared/onboarding-state-types'

export type OnboardingApi = {
  get: () => Promise<OnboardingState>
  // Main merges checklist fields individually.
  update: (
    updates: Partial<Omit<OnboardingState, 'checklist'>> & {
      checklist?: Partial<OnboardingState['checklist']>
    }
  ) => Promise<OnboardingState>
  /** Audience is fixed from the profile saved before the chat upgrade. */
  getNativeChatUpgradeTipVariant: () => Promise<NativeChatUpgradeTipVariant>
}
