import { memo, useEffect, useMemo } from 'react'
import type { ReactElement } from 'react'

import type { AutoSavePhase, AutoSaveStatusSnapshot } from '../lib/autosave'
import type { ProjectLockEvent } from '../lib/locks'
import {
  type AutoSaveHistorySummary,
  type AutoSavePhaseHistoryRequirement,
  type AutoSavePhaseViewConfig,
  type AutoSaveIndicatorToast,
  type AutoSaveIndicatorViewModel,
  deriveAutoSaveIndicatorViewModel
} from '../lib/autosave/indicatorViewModel'
import { type AutoSaveIndicatorTelemetryEvent } from '../lib/autosave/indicatorController'


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
  const viewModel: AutoSaveIndicatorViewModel = useMemo(
    () => deriveAutoSaveIndicatorViewModel({ snapshot, historySummary, lockEvent }),
    [snapshot, historySummary, lockEvent]
  )

  useEffect(() => {
    if (onToast && viewModel.toast) {
      onToast(viewModel.toast)
    }
  }, [onToast, viewModel.toast])

  const historyButtonDisabled = !viewModel.history.canOpen

  return (
    <div
      className="autosave-indicator"
      role="status"
      aria-live={viewModel.indicator === 'error' ? 'assertive' : 'polite'}
      aria-busy={viewModel.isAnimating}
      data-phase={snapshot.phase}
      data-readonly={viewModel.isReadOnly ? 'true' : 'false'}
      data-animating={viewModel.isAnimating ? 'true' : 'false'}
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

export interface AutoSaveIndicatorTestCase {
  readonly id: string
  readonly focus: 'view-model' | 'events'
  readonly description: string
  readonly assertions: readonly string[]
}

export const AUTO_SAVE_INDICATOR_TEST_PLAN: readonly AutoSaveIndicatorTestCase[] = Object.freeze([
  {
    id: 'VM-001',
    focus: 'view-model',
    description: 'idle → 保存完了スナップショットで statusLabel と lastSavedAt が更新される',
    assertions: ['statusLabel=最新状態', 'lastSavedAt が snapshot.lastSuccessAt に一致']
  },
  {
    id: 'VM-002',
    focus: 'view-model',
    description: 'awaiting-lock + retryCount>=1 で isAnimating=true かつ retryLabel 表示',
    assertions: ['isAnimating=true', 'meta.retryLabel に再試行文言を表示']
  },
  {
    id: 'VM-003',
    focus: 'view-model',
    description: 'lock:readonly-entered イベントで isReadOnly とバナーが警告表示になる',
    assertions: ['isReadOnly=true', 'banner.variant=warning']
  },
  {
    id: 'EV-001',
    focus: 'events',
    description: 'awaiting-lock リトライ開始で telemetry retrying-started を 1 回発行する',
    assertions: ['flushTelemetry() が retrying-started を返し、同フェーズ継続中は追加発行しない']
  },
  {
    id: 'EV-002',
    focus: 'events',
    description: 'merge.precision=legacy では isVisible=false を維持する',
    assertions: ['setMergePrecision("legacy") 後も isVisible=false', 'precision 昇格で true に遷移']
  }
])

export interface AutoSaveIndicatorDesignHierarchyEntry {
  readonly id: string; readonly role: 'container' | 'banner' | 'status' | 'meta' | 'history-list' | 'history-actions'; readonly description: string; readonly children?: readonly string[]
}

export interface AutoSaveIndicatorDesignStateEntry {
  readonly key: 'idle' | 'progress' | 'retrying' | 'readonly' | 'fatal-error'; readonly phases: readonly AutoSavePhase[]; readonly readonlyMode: 'no' | 'implicit' | 'forced'; readonly indicator: AutoSavePhaseViewConfig['indicator']; readonly banner?: 'warning' | 'error' | null; readonly historyAccess: AutoSavePhaseHistoryRequirement['access']; readonly actions: readonly ('open-history' | 'request-restore' | 'flush-now')[]; readonly notes: readonly string[]
}

export interface AutoSaveIndicatorDesignScenarioEntry {
  readonly id: 'SCN-OK' | 'SCN-RETRY' | 'SCN-FATAL'; readonly title: string; readonly trigger: string; readonly userGoal: string; readonly systemResponses: readonly string[]; readonly followUp: readonly string[]
}

export const AUTO_SAVE_INDICATOR_DESIGN = Object.freeze({
  hierarchy: [
    { id: 'autosave-indicator', role: 'container', description: 'AutoSave 状態パネル本体。aria-live で状態を放送し、読み取り専用時は data-readonly 属性を付与', children: ['autosave-indicator__banner', 'autosave-indicator__primary', 'autosave-indicator__meta', 'autosave-indicator__history'] },
    { id: 'autosave-indicator__banner', role: 'banner', description: '致命エラー/閲覧専用モードをアラートとして露出。`role=alert` で即時読み上げ' },
    { id: 'autosave-indicator__primary', role: 'status', description: '状態ラベルと概要説明。phase ごとの indicator variant を背景アイコンに反映' },
    { id: 'autosave-indicator__meta', role: 'meta', description: '最終保存時刻・保留中サイズ・エラー詳細などのメタ情報を定義リストとして表示' },
    { id: 'autosave-indicator__history', role: 'history-actions', description: '履歴パネル起動ボタンと使用率警告。`history.access` が disabled の場合は `aria-disabled` で無効化', children: ['autosave-indicator__history-note'] },
    { id: 'autosave-indicator__history-note', role: 'history-list', description: '履歴操作の補足説明と GC 通知テキストを表示' }
  ] as const,
  states: [
    { key: 'idle', phases: ['idle'], readonlyMode: 'no', indicator: 'idle', banner: null, historyAccess: 'available', actions: ['open-history', 'flush-now'], notes: ['最新成功スナップショットを表示', '履歴導線を常時露出'] },
    { key: 'progress', phases: ['debouncing', 'awaiting-lock', 'writing-current', 'updating-index', 'gc'], readonlyMode: 'no', indicator: 'progress', banner: null, historyAccess: 'disabled', actions: ['flush-now'], notes: ['保留中 I/O で履歴操作を抑止', 'ロック待機中は再試行カウンタを表示'] },
    { key: 'retrying', phases: ['awaiting-lock'], readonlyMode: 'implicit', indicator: 'progress', banner: null, historyAccess: 'available', actions: ['open-history'], notes: ['retryCount>=3 で警告トースト', '履歴復元導線を案内'] },
    { key: 'readonly', phases: ['idle', 'debouncing', 'awaiting-lock', 'writing-current', 'updating-index', 'gc', 'error'], readonlyMode: 'forced', indicator: 'warning', banner: 'warning', historyAccess: 'disabled', actions: [], notes: ['lock:readonly-entered で遷移', '解除まで履歴操作を封鎖'] },
    { key: 'fatal-error', phases: ['error'], readonlyMode: 'no', indicator: 'error', banner: 'error', historyAccess: 'available', actions: ['open-history', 'request-restore'], notes: ['再試行不可エラー', '履歴復元と telemetry を優先'] }
  ] as const,
  scenarios: [
    { id: 'SCN-OK', title: '通常保存', trigger: '`debouncing` → `awaiting-lock` → `idle`', userGoal: '編集内容を自動保存させつつ履歴を確認', systemResponses: ['progress 表示で履歴ボタンを一時的に無効化', '保存完了で lastSuccessAt を更新'], followUp: ['履歴パネルから任意世代を閲覧・復元'] },
    { id: 'SCN-RETRY', title: 'ロック再試行', trigger: '`awaiting-lock` かつ `retryCount>=3`', userGoal: '排他ロック解放まで待機', systemResponses: ['警告トーストで再試行中を通知', '履歴ボタンを再び有効化し復元導線を提示'], followUp: ['最新成功世代の復元または待機継続を選択'] },
    { id: 'SCN-FATAL', title: '致命エラー', trigger: '`phase="error"` かつ `retryable=false`', userGoal: '停止理由を把握し復元を開始', systemResponses: ['error バナーで停止理由を強調', 'Collector へ error telemetry を送信'], followUp: ['request-restore イベントで復元モーダルを起動'] }
  ] as const
} satisfies {
  readonly hierarchy: readonly AutoSaveIndicatorDesignHierarchyEntry[]
  readonly states: readonly AutoSaveIndicatorDesignStateEntry[]
  readonly scenarios: readonly AutoSaveIndicatorDesignScenarioEntry[]
})

export interface AutoSaveIndicatorTelemetryPolicyEvent {
  readonly type: AutoSaveIndicatorTelemetryEvent['type']
  readonly trigger: string
  readonly dedupeKey: 'phase' | 'retry' | 'reason'
}

export interface AutoSaveIndicatorTelemetryPolicy {
  readonly emitter: 'state-controller'
  readonly notes: readonly string[]
  readonly events: readonly AutoSaveIndicatorTelemetryPolicyEvent[]
}

export const AUTO_SAVE_INDICATOR_TELEMETRY_POLICY = {
  emitter: 'state-controller' as const,
  notes: [
    'Collector 連携は flushTelemetry() の戻り値を呼び出し元が処理することで UI コンポーネントと分離する',
    'retrying-started は `awaiting-lock` フェーズ継続中 1 度のみ発火し、フェーズ離脱でリセットする',
    'readonly-entered は ProjectLockReadonlyReason 単位で Collector 側へ伝播する'
  ] as const,
  events: [
    { type: 'phase-changed', trigger: 'snapshot() 更新', dedupeKey: 'phase' },
    { type: 'error-shown', trigger: 'snapshot().lastError 変化', dedupeKey: 'phase' },
    { type: 'retrying-started', trigger: 'awaiting-lock で retryCount>0', dedupeKey: 'retry' },
    { type: 'readonly-entered', trigger: 'lock:readonly-entered', dedupeKey: 'reason' }
  ] as const
} satisfies AutoSaveIndicatorTelemetryPolicy

export const AUTO_SAVE_INDICATOR_VIEW_MODEL_GRAPH = `mermaid
stateDiagram-v2
    [*] --> Disabled: phase='disabled'
    Disabled --> Idle: autosave enabled
    Idle --> Debouncing: change event
    Debouncing --> AwaitingLock: idle>=2s
    AwaitingLock --> Writing: phase in {'writing-current','updating-index'}
    Writing --> Gc: phase='gc'
    Gc --> Idle: gc-complete
    AwaitingLock --> Error: AutoSaveError
    Error --> Idle: retry success
    Error --> Disabled: retryable=false
    Idle --> ReadOnly: lock:readonly-entered
    ReadOnly --> Idle: lock reacquired
`

export {
  AUTOSAVE_INDICATOR_MESSAGE_SPEC,
  AUTOSAVE_PHASE_STATE_MAP,
  deriveAutoSaveIndicatorViewModel
} from '../lib/autosave/indicatorViewModel'
export type {
  AutoSaveHistorySummary,
  AutoSaveIndicatorBanner,
  AutoSaveIndicatorLockState,
  AutoSaveIndicatorToast,
  AutoSaveIndicatorViewModel
} from '../lib/autosave/indicatorViewModel'
export { createAutoSaveIndicatorController } from '../lib/autosave/indicatorController'
export type {
  AutoSaveIndicatorController,
  AutoSaveIndicatorControllerOptions,
  AutoSaveIndicatorControllerState,
  AutoSaveIndicatorTelemetryEvent
} from '../lib/autosave/indicatorController'
