import { memo, useEffect, useMemo } from 'react'
import type { ReactElement } from 'react'

import type { AutoSavePhase, AutoSaveStatusSnapshot } from '../lib/autosave'
import type { ProjectLockEvent } from '../lib/locks'

const RETRY_LABEL_THRESHOLD = 3
const HISTORY_USAGE_WARNING_RATIO = 0.9

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

export const AUTOSAVE_PHASE_STATE_MAP = Object.freeze({
  disabled: {
    label: 'AutoSave 無効',
    description:
      'フラグ `autosave.enabled` またはオプション disabled が true。スナップショット/履歴 API は静的なまま',
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
    nextPhases: ['debouncing', 'disabled'],
    indicator: 'idle',
    history: {
      access: 'available',
      note: '`index.json` の降順一覧をそのまま表示し、復元・削除操作を許可する'
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

export interface AutoSaveIndicatorViewModel {
  readonly label: string
  readonly description: string
  readonly indicator: AutoSavePhaseViewConfig['indicator']
  readonly history: AutoSavePhaseHistoryRequirement & { readonly usageWarning?: string }
  readonly meta: {
    readonly lastSuccessAt?: string
    readonly pendingBytes?: number
    readonly retryCount?: number
    readonly retryLabel?: string
    readonly errorMessage?: string
  }
  readonly banner?: AutoSaveIndicatorBanner
  readonly toast?: AutoSaveIndicatorToast
}

export interface DeriveAutoSaveIndicatorViewModelOptions {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly historySummary?: AutoSaveHistorySummary
  readonly lockEvent?: ProjectLockEvent
}

export function deriveAutoSaveIndicatorViewModel({
  snapshot,
  historySummary,
  lockEvent
}: DeriveAutoSaveIndicatorViewModelOptions): AutoSaveIndicatorViewModel {
  const base = AUTOSAVE_PHASE_STATE_MAP[snapshot.phase]
  const retryLabel =
    snapshot.retryCount >= RETRY_LABEL_THRESHOLD ? `再試行中 (${snapshot.retryCount})` : undefined

  const historyUsage = (() => {
    if (!historySummary || base.history.access === 'hidden') {
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
  })()

  const banner = (() => {
    if (lockEvent?.type === 'lock:readonly-entered') {
      const reason =
        lockEvent.reason === 'acquire-failed'
          ? '他のタブが編集しています'
          : lockEvent.reason === 'renew-failed'
          ? 'ロック更新に失敗しました'
          : 'ロック解放に失敗しました'
      return {
        variant: 'warning' as const,
        message: `閲覧専用モードに切り替わりました（${reason}）。` + ' 復元・再試行の前にタブの状態を確認してください。'
      }
    }
    if (snapshot.phase === 'error' && snapshot.lastError && !snapshot.lastError.retryable) {
      return {
        variant: 'error' as const,
        message: `自動保存を停止しました: ${snapshot.lastError.message}`
      }
    }
    return undefined
  })()

  const toast = (() => {
    if (snapshot.lastError && snapshot.lastError.retryable) {
      return { variant: 'warning' as const, message: `自動保存の再試行に失敗しました（${snapshot.lastError.message}）` }
    }
    if (snapshot.retryCount >= RETRY_LABEL_THRESHOLD && snapshot.phase === 'awaiting-lock') {
      return { variant: 'warning' as const, message: `ロック取得を再試行中です (${snapshot.retryCount})` }
    }
    return undefined
  })()

  return {
    label: retryLabel ?? base.label,
    description: base.description,
    indicator: banner?.variant === 'error' ? 'error' : base.indicator,
    history: { ...base.history, usageWarning: historyUsage },
    meta: {
      lastSuccessAt: snapshot.lastSuccessAt,
      pendingBytes: snapshot.pendingBytes,
      retryCount: snapshot.retryCount || undefined,
      retryLabel,
      errorMessage: snapshot.lastError?.message
    },
    banner,
    toast
  }
}

export interface AutoSaveIndicatorProps {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly historySummary?: AutoSaveHistorySummary
  readonly lockEvent?: ProjectLockEvent
  readonly onToast?: (toast: AutoSaveIndicatorToast) => void
  readonly onOpenHistory?: () => void
  readonly historyButtonLabel?: string
}

function AutoSaveIndicatorComponent({
  snapshot,
  historySummary,
  lockEvent,
  onToast,
  onOpenHistory,
  historyButtonLabel = '履歴を開く'
}: AutoSaveIndicatorProps): ReactElement {
  const viewModel = useMemo(
    () => deriveAutoSaveIndicatorViewModel({ snapshot, historySummary, lockEvent }),
    [snapshot, historySummary, lockEvent]
  )

  useEffect(() => {
    if (onToast && viewModel.toast) {
      onToast(viewModel.toast)
    }
  }, [onToast, viewModel.toast])

  const historyButtonDisabled = viewModel.history.access !== 'available'

  return (
    <div
      className="autosave-indicator"
      role="status"
      aria-live={viewModel.indicator === 'error' ? 'assertive' : 'polite'}
      data-phase={snapshot.phase}
    >
      {viewModel.banner ? (
        <div className={`autosave-indicator__banner autosave-indicator__banner--${viewModel.banner.variant}`} role="alert">
          {viewModel.banner.message}
        </div>
      ) : null}
      <div className="autosave-indicator__primary">
        <span className={`autosave-indicator__state autosave-indicator__state--${viewModel.indicator}`}>
          {viewModel.label}
        </span>
        <span className="autosave-indicator__description">{viewModel.description}</span>
      </div>
      <dl className="autosave-indicator__meta">
        {viewModel.meta.lastSuccessAt ? (
          <div>
            <dt>最終保存</dt>
            <dd>{viewModel.meta.lastSuccessAt}</dd>
          </div>
        ) : null}
        {viewModel.meta.pendingBytes ? (
          <div>
            <dt>保留中サイズ</dt>
            <dd>{`${viewModel.meta.pendingBytes} bytes`}</dd>
          </div>
        ) : null}
        {viewModel.meta.retryCount ? (
          <div>
            <dt>再試行回数</dt>
            <dd>{viewModel.meta.retryCount}</dd>
          </div>
        ) : null}
        {viewModel.meta.retryLabel ? (
          <div>
            <dt>状態</dt>
            <dd>{viewModel.meta.retryLabel}</dd>
          </div>
        ) : null}
        {viewModel.meta.errorMessage ? (
          <div className="autosave-indicator__error">
            <dt>エラー</dt>
            <dd>{viewModel.meta.errorMessage}</dd>
          </div>
        ) : null}
        {historySummary ? (
          <div>
            <dt>履歴利用状況</dt>
            <dd>
              {`${historySummary.totalGenerations}/${historySummary.maxGenerations} 世代・${historySummary.totalBytes}/${historySummary.maxBytes} bytes`}
            </dd>
          </div>
        ) : null}
      </dl>
      {viewModel.history.usageWarning ? (
        <p className="autosave-indicator__history-warning" role="alert">
          {viewModel.history.usageWarning}
        </p>
      ) : null}
      {onOpenHistory && viewModel.history.access !== 'hidden' ? (
        <button
          type="button"
          className="autosave-indicator__history"
          onClick={onOpenHistory}
          disabled={historyButtonDisabled}
          aria-disabled={historyButtonDisabled}
        >
          {historyButtonLabel}
        </button>
      ) : null}
      <p className="autosave-indicator__history-note">{viewModel.history.note}</p>
    </div>
  )
}

export const AutoSaveIndicator = memo(AutoSaveIndicatorComponent)
