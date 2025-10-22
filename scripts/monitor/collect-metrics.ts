/**
 * scripts/monitor/collect-metrics.ts
 * ---------------------------------
 * AutoSave / 精緻マージ フェーズロールアウトで使用する Collector CLI の
 * I/O 契約を文書化した TypeScript スキーマ。実装はこのファイルの契約を
 * 遵守し、Day8 アーキテクチャ（Collector → Analyzer → Reporter）の責務分離を
 * 維持すること。
 */

export type RolloutPhase = 'A-0' | 'A-1' | 'A-2' | 'B-0' | 'B-1';

export type MetricsKey =
  | 'autosave_p95'
  | 'restore_success_rate'
  | 'merge_auto_success_rate';

export interface MetricsInputRecord {
  /** ISO8601 形式の計測開始時刻 */
  readonly window_started_at: string;
  /** 計測ウィンドウ（分）。`--window=15m` の場合は 15 を指定。 */
  readonly window_minutes: number;
  /** Collector が観測したロールアウトフェーズ */
  readonly phase: RolloutPhase;
  /** AutoSave 保存遅延の P95（ミリ秒） */
  readonly autosave_p95: number;
  /** 復元成功率（0〜1） */
  readonly restore_success_rate: number;
  /** 自動マージ成功率（0〜1） */
  readonly merge_auto_success_rate: number;
  /** フラグソース（env/localStorage/default）の追跡情報 */
  readonly flag_snapshot?: string;
  /** Collector 内の再試行情報。Analyzer のノイズ除去で利用。 */
  readonly retryable?: boolean;
}

export interface CollectMetricsCliOptions {
  /** 計測対象ウィンドウ。`15m` / `1h` フォーマットをサポート。 */
  readonly window: `${number}m` | `${number}h`;
  /** 解析対象 JSONL（glob or file path）。 */
  readonly input: string;
  /** Analyzer へ渡す JSONL の出力先。省略時は stdout。 */
  readonly output?: string;
  /** Collector フェーズ切替（Phase タグを強制設定）。 */
  readonly phase?: RolloutPhase;
  /**
   * 通知制御。
   * - `auto`: 閾値違反時のみ通知（既定）
   * - `force`: 強制通知（シミュレーションで使用）
   * - `suppress`: 通知を発火せず、JSONL のみ生成
   */
  readonly notify?: 'auto' | 'force' | 'suppress';
  /** `--dry-run` 指定時は Analyzer へ送出せず I/O のみ検証。 */
  readonly dryRun?: boolean;
  /** `--simulate-latency=<ms>` で Collector レイテンシを模擬。 */
  readonly simulateLatency?: number;
  /** `--simulate-breach` のメトリクス上書き値。 */
  readonly simulateBreach?: Partial<Record<MetricsKey, number>>;
}

export interface CollectMetricsNotification {
  /** Slack or PagerDuty */
  readonly channelType: 'slack' | 'pagerduty';
  /** Slack channel 名 or PagerDuty service 名 */
  readonly destination: string;
  /** 閾値を超えたメトリクスキー */
  readonly metric: MetricsKey;
  /** 達成値 */
  readonly value: number;
  /** 閾値 */
  readonly threshold: number;
  /** 通知本文テンプレートのパス（例: templates/alerts/rollback.md） */
  readonly template: string;
}

export interface CollectMetricsArtifacts {
  /** Analyzer に渡す正規化済み JSONL の保存先 */
  readonly normalizedMetricsPath: string;
  /** Slack/PagerDuty 投稿ログの保存先 */
  readonly notificationLogPath: string;
  /** RCA 用の下書きファイルパス */
  readonly rcaDraftPath: string;
}

export interface CollectMetricsContract {
  readonly cli: CollectMetricsCliOptions;
  readonly inputRecord: MetricsInputRecord;
  readonly notifications: ReadonlyArray<CollectMetricsNotification>;
  readonly artifacts: CollectMetricsArtifacts;
}

export const COLLECT_METRICS_CONTRACT: CollectMetricsContract = {
  cli: {
    window: '15m',
    input: 'reports/canary/phase-*.jsonl',
    output: 'reports/monitoring/<timestamp>.jsonl',
    phase: 'A-1',
    notify: 'auto',
    dryRun: false,
    simulateLatency: 0,
    simulateBreach: undefined,
  },
  inputRecord: {
    window_started_at: '2025-01-18T00:00:00Z',
    window_minutes: 15,
    phase: 'A-1',
    autosave_p95: 2300,
    restore_success_rate: 0.999,
    merge_auto_success_rate: 0.0,
    flag_snapshot: 'env:canary',
    retryable: false,
  },
  notifications: [
    {
      channelType: 'slack',
      destination: '#launch-autosave',
      metric: 'autosave_p95',
      value: 3200,
      threshold: 2500,
      template: 'templates/alerts/rollback.md',
    },
    {
      channelType: 'pagerduty',
      destination: 'Autosave & Precision Merge',
      metric: 'merge_auto_success_rate',
      value: 0.72,
      threshold: 0.8,
      template: 'templates/alerts/rollback.md',
    },
  ],
  artifacts: {
    normalizedMetricsPath: 'reports/monitoring/20250118T0000.jsonl',
    notificationLogPath: 'reports/alerts/20250118T0000.md',
    rcaDraftPath: 'reports/rca/phase-A-1-20250118.md',
  },
};
