# Diff Merge Precision ブリッジ設計

## 1. 背景と位置づけ
- `MergeDock`/`DiffMergeView` の分割設計と Phase 制御は [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) の UI ステート管理方針、および Day8 Collector パイプライン ([Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md)) のメトリクス集約フローに準拠する。
- `merge.precision` フラグを `conimg.merge.threshold` (VS Code 設定、既定 0.72) と同期させ、legacy/beta/stable の 3 モードを Phase A/B ガードでブリッジする。
- 目的は Phase B までは Diff タブを露出させず、Phase 遷移と自動採用率 (>=80%) を担保しつつ、Diff Merge 3-way API への移行基盤を用意すること。

## 2. Precision モード別 UI/ステート遷移仕様
| precision | タブ露出 | Phase A エントリ | Phase B ガード | Diff Merge タブ表示条件 | 備考 |
| --- | --- | --- | --- | --- | --- |
| legacy | MergeDock の Legacy タブのみ | 全ハンク auto 適用候補 | 常に `required=false` | 常時非表示 | 既存 UI を保持、Diff API は裏で noop |
| beta | MergeDock: Legacy + (実験) Diff | auto/review をバンド別に分岐 | `phaseB.required` は review エントリ存在時のみ true | Phase B の `required=true` かつ `phaseB.reasons` に `review-band` | フラグ `merge.precision=beta` で Diff タブ表示、Phase A 中は disabled |
| stable | MergeDock: Legacy + Diff | auto/review/conflict を 3-way バンドで分類 | `phaseB.required` は review/locked/low-similarity 合計 > 0 | Phase B 進行時、Phase B ビューを Diff タブで置換 | `phaseB.reasons` に応じて Diff ビューのハイライトモード切替 |

- Phase 遷移ロジックは `MergeDock` → `DiffMergeView` を通じ、Phase B になるまで Diff タブのマウントを抑制。Phase B 突入時に `merge.precision` が beta/stable かつ `phaseB.required=true` を満たせば Diff タブを有効化する。
- legacy モード互換性: `merge.precision=legacy` の場合、既存 Legacy タブのみレンダリングし、Diff 関連の API 呼び出しはスキップ (メソッド署名は維持)。

## 3. merge.request / merge.result I/O コントラクト
```jsonc
// merge.request
{
  "requestId": "uuid",
  "precision": "legacy" | "beta" | "stable",
  "threshold": 0.72,
  "files": [
    {
      "path": "src/components/MergeDock.tsx",
      "hunks": [
        {
          "id": "hunk-1",
          "originalRange": [10, 25],
          "modifiedRange": [10, 27],
          "tokens": { "base": [...], "local": [...], "incoming": [...] }
        }
      ]
    }
  ],
  "telemetry": {
    "sessionId": "uuid",
    "phase": "A" | "B",
    "exposure": {
      "legacyTab": true,
      "diffTab": false
    }
  }
}
```

```jsonc
// merge.result
{
  "requestId": "uuid",
  "precision": "beta",
  "threshold": 0.74,
  "autoAppliedRate": 0.83,
  "bands": {
    "auto": 12,
    "review": 3,
    "conflict": 1
  },
  "phaseA": {
    "entries": [
      {
        "hunkId": "hunk-1",
        "decision": "auto",
        "mergeCommand": "queue:auto-apply"
      }
    ]
  },
  "phaseB": {
    "required": true,
    "reasons": ["review-band"],
    "entries": [
      {
        "hunkId": "hunk-3",
        "decision": "review",
        "mergeCommand": "queue:request-review"
      }
    ]
  },
  "trace": {
    "events": [
      {
        "ts": "2024-05-20T10:12:23.456Z",
        "stage": "scoreSection",
        "metrics": {
          "blended": 0.88,
          "tokenOverlap": 0.91,
          "threshold": 0.74
        }
      }
    ]
  }
}
```

- `threshold` は VS Code 設定 (`conimg.merge.threshold`) の実効値を反映。beta/stable モードでは Phase B に入るたび trace 内に当該値を記録して diff 収束検証を可能にする。
- `autoAppliedRate` は Phase A で自動適用されたハンク数 / 総ハンク数。0.80 未満であれば Collector に warning を送る。

## 4. Trace フォーマット定義
- `trace.events[]` は時系列ソート済みの JSON オブジェクト。
- 各イベントは `{ ts: ISO8601, stage: 'scoreSection' | 'decideSection' | 'planPhase' | 'queueMergeCommand', metrics: Record<string, number|string> }`。
- `stage='decideSection'` では `{ blended, threshold, band }` を、`stage='planPhase'` では `{ phase: 'A'|'B', required: boolean }` を必須とする。
- Collector ログへの出力は JSONL。1 行に `{"type":"merge.trace","payload":<trace>}` を書き出し、Day8 Collector が Analyzer に 15 分バッチで転送する。
- テレメトリ負荷はイベント数をハンク数×4 以下に制限。Phase B 以降に限り Diff タブ操作 (`tabActivated`, `hunkReviewed`) を追加イベントとして記録する。

## 5. conimg.merge.threshold と Phase ガード連携表
| precision | VS Code 設定 (`conimg.merge.threshold`) | request.threshold | auto band | review band | conflict band | Phase B required 条件 |
| --- | --- | --- | --- | --- | --- | --- |
| legacy | `cfg` | `max(cfg, 0.65)` | `>= threshold+0.08` | なし | なし | false |
| beta | `cfg` | `clamp(cfg, 0.68, 0.9)` | `>= threshold+0.05` | `[threshold-0.02, threshold+0.05)` | `< threshold-0.02` またはロック | review band >0 |
| stable | `cfg` | `clamp(cfg, 0.7, 0.94)` | `>= threshold+0.03` | `[threshold-0.01, threshold+0.03)` | `< threshold-0.01` or lock | (review+conflict)>0 |

- `cfg` は VS Code 設定 UI (default 0.72)。`merge.request.threshold` は Phase ごとに clamping された値を使用し、Phase A/B で共通化。
- Phase B が無効な場合 (`required=false`) は Diff タブのアクティベーションをスキップし、Telemetry 露出率計算から除外する。

## 6. テレメトリ設計更新
1. Collector
   - `merge.trace` (上記) と `merge.diffTabExposure` を JSONL で記録。
   - `merge.diffTabExposure` スキーマ: `{ sessionId, precision, phase, diffTabShown: boolean, autoAppliedRate, eventTs }`。
   - 自動採用率 0.80 未満の場合は `severity='warn'` を添付し Analyzer に通知。
2. Analyzer
   - beta/stable モードの露出率を計算: `shown_sessions / eligible_sessions`。
   - 自動採用率 >=80% を毎日集計し、低下時に `reports/today.md` の Merge セクションへ警告を挿入。
3. Reporter
   - Diff タブ露出率、平均自動採用率、Phase B 進入率を Day8 Pipeline (Day8/docs/day8/design/03_architecture.md) 経由で `reports/merge_metrics.md` に週次追記。
4. Governance
   - 露出率が 40% 未満または自動採用率が 80% を下回る状態が 3 日連続した場合、`governance/policy.yaml` の Merge KPI を更新する提案を自動生成。

## 7. Precision モード統合テスト方針
- `tests/merge/diffmerge.webview.test.ts` に RED テストを追加: precision モードごとにタブ遷移と自動採用率 80% チェックを失敗させるケースを先に実装。
- 実装フェーズで Diff タブ露出条件と自動採用率算出を満たし GREEN 化。
- テストでは `merge.request`/`merge.result` モックを使用し、Trace JSON が UI と core 境界を跨いで連動することを検証。

## 8. Telemetry パイプラインとの整合
- Day8 Collector パイプラインでは `merge.trace` と `merge.diffTabExposure` を autosave 系イベントと同一ストリームで処理し、既存の ±5% 負荷以内に収まるようイベント数を制限する。
- Analyzer→Reporter→Governance の流れは [Day8/docs/day8/design/03_architecture.md](../../Day8/docs/day8/design/03_architecture.md) の既存手順に従い、Merge 指標を追加メトリクスとして扱う。
- 保存ポリシーや UI 非同期挙動は [docs/AUTOSAVE-DESIGN-IMPL.md](../AUTOSAVE-DESIGN-IMPL.md) のセッション管理と同一メカニズムで保持し、Diff タブが遅延描画されても autosave が干渉しないようにする。
