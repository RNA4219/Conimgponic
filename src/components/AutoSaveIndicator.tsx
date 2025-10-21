import { memo } from 'react'
import type { ReactElement } from 'react'

import type { AutoSavePhase, AutoSaveStatusSnapshot } from '../lib/autosave'

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

export interface AutoSaveIndicatorProps {
  readonly snapshot: AutoSaveStatusSnapshot
  readonly onOpenHistory?: () => void
  readonly historyButtonLabel?: string
}

function AutoSaveIndicatorComponent({
  snapshot,
  onOpenHistory,
  historyButtonLabel = '履歴を開く'
}: AutoSaveIndicatorProps): ReactElement {
  const config = AUTOSAVE_PHASE_STATE_MAP[snapshot.phase]
  const historyButtonDisabled = config.history.access !== 'available'

  return (
    <div
      className="autosave-indicator"
      role="status"
      aria-live={config.indicator === 'error' ? 'assertive' : 'polite'}
      data-phase={snapshot.phase}
    >
      <div className="autosave-indicator__primary">
        <span className={`autosave-indicator__state autosave-indicator__state--${config.indicator}`}>
          {config.label}
        </span>
        <span className="autosave-indicator__description">{config.description}</span>
      </div>
      <dl className="autosave-indicator__meta">
        {snapshot.lastSuccessAt ? (
          <div>
            <dt>最終保存</dt>
            <dd>{snapshot.lastSuccessAt}</dd>
          </div>
        ) : null}
        {snapshot.pendingBytes ? (
          <div>
            <dt>保留中サイズ</dt>
            <dd>{`${snapshot.pendingBytes} bytes`}</dd>
          </div>
        ) : null}
        {snapshot.retryCount ? (
          <div>
            <dt>再試行回数</dt>
            <dd>{snapshot.retryCount}</dd>
          </div>
        ) : null}
        {snapshot.lastError ? (
          <div className="autosave-indicator__error">
            <dt>エラー</dt>
            <dd>{snapshot.lastError.message}</dd>
          </div>
        ) : null}
      </dl>
      {onOpenHistory && config.history.access !== 'hidden' ? (
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
      <p className="autosave-indicator__history-note">{config.history.note}</p>
    </div>
  )
}

export const AutoSaveIndicator = memo(AutoSaveIndicatorComponent)
