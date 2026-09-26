import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

export type DiffNavigationTarget = {
  changeCount: number
  goToPreviousDiff: () => void
  goToNextDiff: () => void
}

export type DiffNavigationRegistrationContextValue = {
  registerDiffNavigation: (target: DiffNavigationTarget) => void
  unregisterDiffNavigation: (target: DiffNavigationTarget) => void
}

export type DiffNavigationContextValue = DiffNavigationTarget

const noop = (): void => {}

const DiffNavigationRegistrationContext = createContext<DiffNavigationRegistrationContextValue>({
  registerDiffNavigation: noop,
  unregisterDiffNavigation: noop
})

const DiffNavigationContext = createContext<DiffNavigationContextValue>({
  goToPreviousDiff: noop,
  goToNextDiff: noop,
  changeCount: 0
})

export function DiffNavigationProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const targetRef = useRef<DiffNavigationTarget | null>(null)
  const [target, setTarget] = useState<DiffNavigationTarget>({
    goToPreviousDiff: noop,
    goToNextDiff: noop,
    changeCount: 0
  })

  const registerDiffNavigation = useCallback((nextTarget: DiffNavigationTarget) => {
    targetRef.current = nextTarget
    setTarget(nextTarget)
  }, [])
  const unregisterDiffNavigation = useCallback((currentTarget: DiffNavigationTarget) => {
    if (targetRef.current !== currentTarget) {
      return
    }
    targetRef.current = null
    setTarget({ goToPreviousDiff: noop, goToNextDiff: noop, changeCount: 0 })
  }, [])

  const registrationValue = useMemo(
    () => ({ registerDiffNavigation, unregisterDiffNavigation }),
    [registerDiffNavigation, unregisterDiffNavigation]
  )

  return (
    <DiffNavigationRegistrationContext.Provider value={registrationValue}>
      <DiffNavigationContext.Provider value={target}>{children}</DiffNavigationContext.Provider>
    </DiffNavigationRegistrationContext.Provider>
  )
}

export function useDiffNavigationRegistration(): DiffNavigationRegistrationContextValue {
  return useContext(DiffNavigationRegistrationContext)
}

export function useDiffNavigation(): DiffNavigationContextValue {
  return useContext(DiffNavigationContext)
}
