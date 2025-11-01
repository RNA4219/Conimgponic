export interface AutoSaveSchedulerCallbacks {
  readonly onFlush: (reason: 'change' | 'flushNow') => Promise<void> | void
}

export interface AutoSaveSchedulerOptions {
  readonly debounceMs: number
  readonly idleMs: number
  readonly clock?: {
    readonly setTimeout?: typeof setTimeout
    readonly clearTimeout?: typeof clearTimeout
  }
}

export interface AutoSaveSchedulerBackoffPlan {
  readonly delayMs: number
  readonly reason: 'change' | 'flushNow'
  readonly attempt: number
  readonly onReady: () => void
}

export interface AutoSaveSchedulerContract {
  readonly start: () => void
  readonly scheduleFlush: (reason: 'change' | 'flushNow') => Promise<void>
  readonly enterBackoff: (plan: AutoSaveSchedulerBackoffPlan) => void
  readonly awaitIdle: () => Promise<void>
  readonly dispose: () => Promise<void>
}

export const createAutoSaveScheduler = (
  callbacks: AutoSaveSchedulerCallbacks,
  options: AutoSaveSchedulerOptions
): AutoSaveSchedulerContract => {
  const setTimer = options.clock?.setTimeout ?? setTimeout
  const clearTimer = options.clock?.clearTimeout ?? clearTimeout
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let backoffTimer: ReturnType<typeof setTimeout> | null = null
  let idlePromise: Promise<void> | null = null
  let resolveIdle: (() => void) | null = null
  let backoffPromise: Promise<void> | null = null
  let resolveBackoff: (() => void) | null = null
  let disposed = false
  let backoffActive = false

  const clearDebounce = () => {
    if (debounceTimer) {
      clearTimer(debounceTimer)
      debounceTimer = null
    }
  }

  const clearIdle = () => {
    if (idleTimer) {
      clearTimer(idleTimer)
      idleTimer = null
    }
    if (resolveIdle) {
      resolveIdle()
      resolveIdle = null
      idlePromise = null
    }
  }

  const resetSchedule = () => {
    clearDebounce()
    clearIdle()
  }

  const cancelBackoff = () => {
    if (backoffTimer) {
      clearTimer(backoffTimer)
      backoffTimer = null
    }
    if (resolveBackoff) {
      resolveBackoff()
      resolveBackoff = null
      backoffPromise = null
    }
    backoffActive = false
  }

  const scheduleAutoFlush = () => {
    if (disposed || backoffActive) {
      return
    }
    clearIdle()
    idlePromise = new Promise<void>((resolve) => {
      resolveIdle = resolve
    })
    idleTimer = setTimer(() => {
      idleTimer = null
      if (resolveIdle) {
        resolveIdle()
        resolveIdle = null
        idlePromise = null
      }
      if (disposed || backoffActive) {
        return
      }
      try {
        const result = callbacks.onFlush('change')
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          ;(result as Promise<unknown>).catch(() => undefined)
        }
      } catch {
        // ignore auto flush errors
      }
    }, options.idleMs)
  }

  const scheduleDebounce = () => {
    if (disposed || backoffActive) {
      return
    }
    clearDebounce()
    clearIdle()
    debounceTimer = setTimer(() => {
      debounceTimer = null
      scheduleAutoFlush()
    }, options.debounceMs)
  }

  return {
    start: () => {
      resetSchedule()
      cancelBackoff()
    },
    scheduleFlush: async (reason) => {
      if (disposed) {
        return
      }
      if (reason === 'flushNow') {
        resetSchedule()
        cancelBackoff()
        await callbacks.onFlush('flushNow')
        return
      }
      resetSchedule()
      scheduleDebounce()
    },
    enterBackoff: (plan) => {
      if (disposed) {
        return
      }
      resetSchedule()
      cancelBackoff()
      backoffActive = true
      const promise = new Promise<void>((resolve) => {
        resolveBackoff = resolve
      })
      backoffPromise = promise
      backoffTimer = setTimer(() => {
        backoffTimer = null
        if (resolveBackoff) {
          resolveBackoff()
          resolveBackoff = null
          backoffPromise = null
        }
        backoffActive = false
        if (!disposed) {
          try {
            plan.onReady()
          } catch {
            // caller is responsible for error handling
          }
        }
      }, plan.delayMs)
    },
    awaitIdle: () => {
      if (idlePromise) {
        return idlePromise
      }
      return Promise.resolve()
    },
    dispose: async () => {
      if (disposed) {
        return
      }
      disposed = true
      resetSchedule()
      cancelBackoff()
      const pending: Promise<void>[] = []
      if (backoffPromise) {
        pending.push(backoffPromise)
      }
      if (idlePromise) {
        pending.push(idlePromise)
      }
      if (pending.length > 0) {
        await Promise.allSettled(pending)
      }
    }
  }
}
