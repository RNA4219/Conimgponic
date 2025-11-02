import type { AutoSavePhase, AutoSaveStatusSnapshot } from '../autosave'
import type { ProjectLockEvent, ProjectLockReadonlyReason } from '../locks'

const RETRY_LABEL_THRESHOLD = 3
const HISTORY_USAGE_WARNING_RATIO = 0.9
const ANIMATING_PHASES: ReadonlySet<AutoSavePhase> = new Set([
  'dirty',
  'debouncing',
  'awaiting-lock',
  'backoff',
  'writing-current',
  'updating-index',
  'gc'
])
const READONLY_STATUS_LABEL = '閲覧専用モード'

type AutoSaveIndicatorMessageSpecKey = keyof typeof AUTOSAVE_INDICATOR_MESSAGE_SPEC

function renderTemplate(template: string, replacements: Record<string, string | undefined>): string {
  return Object.entries(replacements).reduce<string>((result, [key, value]) => {
    const pattern = new RegExp(`\\{\\{${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\}}`, 'g')
    return result.replace(pattern, value ?? '')
  }, template)
}

function resolveReadonlyReasonLabel(reason?: ProjectLockReadonlyReason): string {
  switch (reason) {
    case 'acquire-failed':
      return '他のタブが編集しています'
    case 'renew-failed':
      return 'ロック更新に失敗しました'
    case 'release-failed':
      return 'ロック解放に失敗しました'
    default:
      return 'ロック状態を確認してください'
  }
}

export interface AutoSaveHistorySummary {
  readonly totalGenerations: number
  readonly maxGenerations: number
  readonly totalBytes: number
  readonly maxBytes: number
  readonly overflowDetected?: boolean
}

export interface AutoSavePhaseHistoryRequirement {
  readonly access: 'hidden' | 'available' | 'disabled'
  readonly note: string
}

export interface AutoSavePhaseViewConfig {
  readonly label: string
  readonly description: string
  readonly nextPhases: readonly AutoSavePhase[]
  readonly indicator: 'idle' | 'progress' | 'warning' | 'error'
  readonly history: AutoSavePhaseHistoryRequirement
}

export type AutoSaveIndicatorMessageSpecEntry = {
  readonly when: string
  readonly banner?: AutoSaveIndicatorBanner
  readonly toast?: AutoSaveIndicatorToast
  readonly historyAccess?: AutoSavePhaseHistoryRequirement['access']
  readonly notes: readonly string[]
}

export const AUTOSAVE_INDICATOR_MESSAGE_SPEC = Object.freeze({
  success: {
    when: '`autosave:success` 受領直後または `snapshot.phase === "idle"` へ遷移した直後',
    notes: ['バナー/トーストは表示せず、履歴アクセスは `available` を維持']
  },
  retryableFailure: {
    when:
      '`autosave:failure` かつ `error.retryable === true`。`awaiting-lock` 再試行を含む連続失敗時',
    toast: { variant: 'warning' as const, message: '自動保存の再試行に失敗しました（{{error.message}}）' },
    historyAccess: 'available',
    notes: ['履歴からの手動復元を案内しつつ自動再試行を継続']
  },
  fatalFailure: {
    when: '`snapshot.phase === "error"` かつ `lastError.retryable === false`',
    banner: { variant: 'error' as const, message: '自動保存を停止しました: {{lastError.message}}' },
    historyAccess: 'available',
    notes: ['再試行不可のため履歴経由の復元導線を強調']
  },
  readonlyEntered: {
    when: '`lock:readonly-entered` を受領、または `lockState.mode === "readonly"` へ遷移した直後',
    banner: {
      variant: 'warning' as const,
      message: '閲覧専用モードに切り替わりました（{{reasonLabel}}）'
    },
    historyAccess: 'disabled',
    notes: ['排他ロックが解除されるまで履歴操作ボタンを非活性化']
  }
} satisfies Record<'success' | 'retryableFailure' | 'fatalFailure' | 'readonlyEntered', AutoSaveIndicatorMessageSpecEntry>)

export const AUTOSAVE_PHASE_STATE_MAP = Object.freeze({
  disabled: {
    label: 'AutoSave 無効',
    description:
      'フラグ `autosave.enabled` またはオプション disabled が true。ナップショット/履歴 API は静的なまま',
    nextPhases: ['idle'],
    indicator: 'idle',
    history: {
      access: 'hidden',
      note: '永続化を行わないため `index.json` / `history/*.json` の参照 UI を表示しない'
    }
  },
  idle: {
    label: '最新状態',
    description:
      '直近の書き込みが成功し、次の変更を待機中。`lastSuccessAt` を履歴リストの最新エントリとして扱う',
    nextPhases: ['dirty', 'debouncing', 'disabled'],
    indicator: 'idle',
    history: {
      access: 'available',
      note: '`index.json` の降順一覧をそのまま表示し、復元・削除操作を許可する'
    }
  },
  dirty: {
    label: '保存待機',
    description:
      '入力変化を検知し 500ms デバウンス中。`pendingBytes` を見積もりつつタイマー完了を待つ',
    nextPhases: ['idle', 'awaiting-lock'],
    indicator: 'progress',
    history: {
      access: 'available',
      note: '履歴への追加はまだ発生していないため既存エントのみを表示（編集は許可）'
    }
  },
  debouncing: {
    label: '保存待機',
    description:
      '入力変化を検知し 500ms デバウンス中。`pendingBytes` を見積もりつつタイマー完了を待つ',
    nextPhases: ['idle', 'awaiting-lock'],
    indicator: 'progress',
    history: {
      access: 'available',
      note: '履歴への追加はまだ発生していないため既存エントリのみを表示（編集は許可）'
    }
  },
  'awaiting-lock': {
    label: 'ロック取得中',
    description:
      'Web Lock 優先で取得を試行。失敗時は指数バックオフで `retryCount` を更新し UI へ通知',
    nextPhases: ['writing-current', 'debouncing', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '同一タブ二重保存を避けるため履歴操作をブロックし、Collector ログも 1 行に抑制'
    }
  },
  backoff: {
    label: '再試行待機',
    description:
      '再試行可能なエラーから回復中。指数バックオフ中に `retryCount` を維持し次の保存を待機',
    nextPhases: ['debouncing', 'awaiting-lock', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: 'バックオフ完了までは履歴操作を無効化し、再試行後に再度ロック取得を試みる'
    }
  },
  'writing-current': {
    label: 'current.json 更新',
    description:
      'テンポラリへ書き込み後に原子的リネーム。失敗時は `write-failed` として再試行対象',
    nextPhases: ['updating-index', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '`current.json` 書換中は履歴メニューを無効化し、操作による競合を避ける'
    }
  },
  'updating-index': {
    label: 'index.json 更新',
    description:
      '履歴メタデータを更新し、世代番号をインクリメント。`queuedGeneration` を UI に反映',
    nextPhases: ['gc', 'error'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '`index.json` コミット前は履歴表示が不完全になるため操作を禁止'
    }
  },
  gc: {
    label: '履歴ガーベジコレクト',
    description:
      'FIFO で `maxGenerations`・`maxBytes` を満たすよう古い履歴を削除し整合性を確認',
    nextPhases: ['idle'],
    indicator: 'progress',
    history: {
      access: 'disabled',
      note: '削除対象確定までは履歴一覧と競合するためボタンを一時的に無効化'
    }
  },
  error: {
    label: 'エラー',
    description:
      '再試行不可エラーまたは連続失敗上限を超過。`lastError` 内容を表示し履歴からの復元を促す',
    nextPhases: ['idle', 'disabled'],
    indicator: 'error',
    history: {
      access: 'available',
      note: '復元操作を優先できるよう履歴メニューを常時表示し、最新成功分へ案内'
    }
  }
} satisfies Record<AutoSavePhase, AutoSavePhaseViewConfig>)

export interface AutoSaveIndicatorToast {
  readonly variant: 'warning' | 'error'
  readonly message: string
}

export interface AutoSaveIndicatorBanner {
  readonly variant: 'warning' | 'error'
  readonly message: string
}

export interface AutoSaveIndicatorLockState {
  readonly mode: 'unlocked' | 'exclusive' | 'readonly'
  readonly reason?: ProjectLockReadonlyReason
  readonly lastEvent?: ProjectLockEvent
  readonly since: number
}

export interface AutoSaveIndicatorViewModel {
  readonly statusLabel: string
  readonly label: string
  readonly description: string
  readonly indicator: AutoSavePhaseViewConfig['indicator']
  readonly history: AutoSavePhaseHistoryRequirement & {
    readonly usageWarning?: string
    readonly canOpen: boolean
  }
  readonly meta: {
    readonly lastSuccessAt?: string
    readonly pendingBytes?: number
    readonly retryCount?: number
    readonly retryLabel?: string
    readonly errorMessage?: string
  }
  readonly isAnimating: boolean
  readonly isReadOnly: boolean
  readonly lastSavedAt?: string
  readonly banner?: AutoSaveIndicatorBanner
  readonly toast?: AutoSaveIndicatorToast
}

export interface DeriveAutoSaveIndicatorViewModelOptions {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly historySummary?: AutoSaveHistorySummary
  readonly lockEvent?: ProjectLockEvent
  readonly lockState?: AutoSaveIndicatorLockState
}

export interface ResolveAutoSaveIndicatorMessageSpecKeyOptions {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly isReadOnly: boolean
}

export function resolveAutoSaveIndicatorMessageSpecKey({
  snapshot,
  isReadOnly
}: ResolveAutoSaveIndicatorMessageSpecKeyOptions): AutoSaveIndicatorMessageSpecKey | null {
  if (isReadOnly) {
    return 'readonlyEntered'
  }
  if (snapshot.phase === 'error' && snapshot.lastError && snapshot.lastError.retryable === false) {
    return 'fatalFailure'
  }
  if (snapshot.lastError?.retryable) {
    return 'retryableFailure'
  }
  if (snapshot.phase === 'idle') {
    return 'success'
  }
  return null
}

export interface BuildAutoSaveIndicatorHistoryViewOptions {
  readonly base: AutoSavePhaseHistoryRequirement
  readonly historySummary?: AutoSaveHistorySummary
  readonly isReadOnly: boolean
  readonly messageSpec: AutoSaveIndicatorMessageSpecEntry | null
  readonly readonlyNote: string
}

export function buildAutoSaveIndicatorHistoryView({
  base,
  historySummary,
  isReadOnly,
  messageSpec,
  readonlyNote
}: BuildAutoSaveIndicatorHistoryViewOptions): AutoSavePhaseHistoryRequirement & {
  readonly usageWarning?: string
  readonly canOpen: boolean
} {
  if (isReadOnly) {
    return {
      access: 'disabled',
      note: readonlyNote,
      usageWarning: undefined,
      canOpen: false
    }
  }

  const baseAccess = base.access
  let access = baseAccess
  let note = base.note
  if (messageSpec?.historyAccess) {
    access = messageSpec.historyAccess
  }
  if (messageSpec?.notes && messageSpec.notes.length > 0) {
    note = messageSpec.notes[0]
  }

  const canOpen = access === 'available'
  const usageWarning = canOpen && baseAccess !== 'hidden'
    ? resolveHistoryUsageWarning(historySummary)
    : undefined

  return {
    access,
    note,
    usageWarning,
    canOpen
  }
}

export interface BuildAutoSaveIndicatorBannerOptions {
  readonly isReadOnly: boolean
  readonly lockState?: AutoSaveIndicatorLockState
  readonly effectiveLockEvent?: ProjectLockEvent
  readonly messageSpec: AutoSaveIndicatorMessageSpecEntry | null
  readonly messageSpecKey: AutoSaveIndicatorMessageSpecKey | null
  readonly snapshot: AutoSaveStatusSnapshot
}

export function buildAutoSaveIndicatorBanner({
  isReadOnly,
  lockState,
  effectiveLockEvent,
  messageSpec,
  messageSpecKey,
  snapshot
}: BuildAutoSaveIndicatorBannerOptions): AutoSaveIndicatorBanner | undefined {
  if (isReadOnly) {
    const readonlyReason = lockState?.reason ??
      (effectiveLockEvent?.type === 'lock:readonly-entered' ? effectiveLockEvent.reason : undefined)
    const reasonLabel = resolveReadonlyReasonLabel(readonlyReason)
    const template = messageSpec?.banner?.message ??
      AUTOSAVE_INDICATOR_MESSAGE_SPEC.readonlyEntered.banner?.message ??
      '閲覧専用モードに切り替わりました（{{reasonLabel}}）'
    const variant = messageSpec?.banner?.variant ??
      AUTOSAVE_INDICATOR_MESSAGE_SPEC.readonlyEntered.banner?.variant ??
      'warning'
    return {
      variant,
      message: renderTemplate(template, { reasonLabel })
    }
  }

  if (messageSpecKey === 'fatalFailure' && messageSpec?.banner) {
    return {
      variant: messageSpec.banner.variant,
      message: renderTemplate(messageSpec.banner.message, {
        'lastError.message': snapshot.lastError?.message ?? ''
      })
    }
  }

  return undefined
}

export interface BuildAutoSaveIndicatorToastOptions {
  readonly messageSpec: AutoSaveIndicatorMessageSpecEntry | null
  readonly snapshot: AutoSaveStatusSnapshot
}

export function buildAutoSaveIndicatorToast({
  messageSpec,
  snapshot
}: BuildAutoSaveIndicatorToastOptions): AutoSaveIndicatorToast | undefined {
  if (messageSpec?.toast) {
    return {
      variant: messageSpec.toast.variant,
      message: renderTemplate(messageSpec.toast.message, {
        'error.message': snapshot.lastError?.message ?? '',
        retryCount: snapshot.retryCount.toString()
      })
    }
  }

  if (snapshot.retryCount >= RETRY_LABEL_THRESHOLD && snapshot.phase === 'awaiting-lock') {
    return { variant: 'warning', message: `ロック取得を再試行中です (${snapshot.retryCount})` }
  }

  return undefined
}

function resolveHistoryUsageWarning(historySummary?: AutoSaveHistorySummary): string | undefined {
  if (!historySummary) {
    return undefined
  }
  const generationsRatio = historySummary.maxGenerations
    ? historySummary.totalGenerations / historySummary.maxGenerations
    : 0
  const bytesRatio = historySummary.maxBytes ? historySummary.totalBytes / historySummary.maxBytes : 0
  if (historySummary.overflowDetected || historySummary.totalGenerations >= historySummary.maxGenerations) {
    return '履歴の世代数が上限に達しました。古い履歴から順に削除されます。'
  }
  if (bytesRatio >= 1 || historySummary.totalBytes >= historySummary.maxBytes) {
    return '履歴の保存容量が上限に達しました。自動で容量調整を実行しています。'
  }
  if (generationsRatio >= HISTORY_USAGE_WARNING_RATIO || bytesRatio >= HISTORY_USAGE_WARNING_RATIO) {
    return '履歴の利用率が 90% を超えています。不要な世代を整理してください。'
  }
  return undefined
}

export function deriveAutoSaveIndicatorViewModel({
  snapshot,
  historySummary,
  lockEvent,
  lockState
}: DeriveAutoSaveIndicatorViewModelOptions): AutoSaveIndicatorViewModel {
  const base = AUTOSAVE_PHASE_STATE_MAP[snapshot.phase]
  const retryLabel =
    snapshot.retryCount >= RETRY_LABEL_THRESHOLD ? `再試行中 (${snapshot.retryCount})` : undefined

  const effectiveLockEvent = lockState?.lastEvent ?? lockEvent
  const isReadOnly =
    lockState?.mode === 'readonly' || effectiveLockEvent?.type === 'lock:readonly-entered'
  const messageSpecKey = resolveAutoSaveIndicatorMessageSpecKey({ snapshot, isReadOnly })
  const messageSpec: AutoSaveIndicatorMessageSpecEntry | null = messageSpecKey
    ? AUTOSAVE_INDICATOR_MESSAGE_SPEC[messageSpecKey]
    : null
  const statusLabel = (() => {
    if (isReadOnly) {
      return READONLY_STATUS_LABEL
    }
    if (snapshot.lastError?.retryable === false) {
      return '自動保存を停止しました'
    }
    if (snapshot.phase === 'error') {
      return '自動保存エラー'
    }
    return retryLabel ?? base.label
  })()
  const isAnimating = ANIMATING_PHASES.has(snapshot.phase) && !isReadOnly
  const lastSavedAt = snapshot.lastSuccessAt

  const readonlyNote = messageSpec?.notes?.[0] ??
    AUTOSAVE_INDICATOR_MESSAGE_SPEC.readonlyEntered.notes[0] ??
    base.history.note
  const historyView = buildAutoSaveIndicatorHistoryView({
    base: base.history,
    historySummary,
    isReadOnly,
    messageSpec,
    readonlyNote
  })

  const banner = buildAutoSaveIndicatorBanner({
    isReadOnly,
    lockState,
    effectiveLockEvent,
    messageSpec,
    messageSpecKey,
    snapshot
  })

  const toast = buildAutoSaveIndicatorToast({
    messageSpec,
    snapshot
  })

  return {
    statusLabel,
    label: statusLabel,
    description: base.description,
    indicator: banner?.variant === 'error' ? 'error' : isReadOnly ? 'warning' : base.indicator,
    history: historyView,
    meta: {
      lastSuccessAt: snapshot.lastSuccessAt,
      pendingBytes: snapshot.pendingBytes,
      retryCount: snapshot.retryCount || undefined,
      retryLabel,
      errorMessage: snapshot.lastError?.message
    },
    isAnimating,
    isReadOnly,
    lastSavedAt,
    banner,
    toast
  }
}

export function isViewModelEqual(a: AutoSaveIndicatorViewModel, b: AutoSaveIndicatorViewModel): boolean {
  if (a === b) {
    return true
  }
  return (
    a.statusLabel === b.statusLabel &&
    // label は UI 上の表示テキストで差分検知が必要
    a.label === b.label &&
    a.description === b.description &&
    a.indicator === b.indicator &&
    a.isAnimating === b.isAnimating &&
    a.isReadOnly === b.isReadOnly &&
    a.lastSavedAt === b.lastSavedAt &&
    a.history.access === b.history.access &&
    a.history.note === b.history.note &&
    a.history.usageWarning === b.history.usageWarning &&
    a.history.canOpen === b.history.canOpen &&
    a.meta.lastSuccessAt === b.meta.lastSuccessAt &&
    a.meta.pendingBytes === b.meta.pendingBytes &&
    a.meta.retryCount === b.meta.retryCount &&
    a.meta.retryLabel === b.meta.retryLabel &&
    a.meta.errorMessage === b.meta.errorMessage &&
    (a.banner?.variant ?? null) === (b.banner?.variant ?? null) &&
    (a.banner?.message ?? null) === (b.banner?.message ?? null) &&
    (a.toast?.variant ?? null) === (b.toast?.variant ?? null) &&
    (a.toast?.message ?? null) === (b.toast?.message ?? null)
  )
}
