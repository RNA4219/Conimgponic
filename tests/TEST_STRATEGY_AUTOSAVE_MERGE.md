# AutoSave / Diff Merge テスト戦略

## 1. 目的
- docs/IMPLEMENTATION-PLAN.md の TDD チェックリスト 6 項目を起点に、AutoSave・Diff Merge・CLI/Collector の後方互換を証跡化する試験の全体像を同期する。
- 既存ディレクトリ別の試験計画を横串に整理し、Phase A/B ロールアウトのゲート条件を明確化する。

## 2. tests ディレクトリ別ケース表
| ディレクトリ | ユニット試験 (TDD 対応項目) | 統合/スナップショット試験 | 備考 |
| --- | --- | --- | --- |
| tests/autosave | AS-U-01 / AS-U-02 / AS-U-03 | AS-I-01 / AS-I-02 / AS-I-03 | 実装計画は `tests/autosave/TEST_PLAN.md` を参照 |
| tests/merge | MD-U-01 / MD-U-02 / MD-U-03 | MD-I-01 / MD-I-02 / MD-V-01 | 実装計画は `tests/merge/TEST_PLAN.md` を参照 |
| tests/cli | CC-U-01 / CC-U-02 / CC-U-03 | CC-I-01 / CC-S-01 | 実装計画は `tests/cli/TEST_PLAN.md` を参照 |
| tests/telemetry | - | - | 実装計画は `tests/telemetry/TEST_PLAN.md` を参照 |

## 3. フラグシナリオと必要モック/フィクスチャ
### 3.1 AutoSave / Diff Merge フラグ組み合わせ
| シナリオ ID | autosave.enabled | merge.precision | 主担当ディレクトリ | 使用モック/フィクスチャ | 目的 |
| --- | --- | --- | --- | --- | --- |
| S-A0 | OFF | legacy | tests/autosave, tests/cli | MockStoryboard, ManualSaveShortcutMock | 既存保存・CLI 出力の基準ライン確定 |
| S-A1 | ON | legacy | tests/autosave, tests/telemetry | MockWebLock, MockFileLock | AutoSave 起動と Collector 送信経路検証 |
| S-A2 | ON | beta | tests/merge, tests/cli, tests/telemetry | MockMergePackage, FlagMatrix, Telemetry | Diff Merge タブ導線とメタ保持互換検証 |
| S-A3 | ON | stable | tests/merge, tests/cli, tests/telemetry | MockMergePackageStable, FlagMatrix, CollectorEnvelope | 安定形の最終検証 |

### 3.2 CLI 互換性補足
| ケース | 依存フラグ | 追加モック/フィクスチャ | チェックポイント |
| --- | --- | --- | --- |
| CLI-JS-01 | S-A0 | 既存 JSON スナップショット | output一致検証 |

## 4. テスト実行コマンドとゲート条件
### 4.1 推奨コマンド
- pnpm lint
- pnpm typecheck
- pnpm test --filter autosave
- pnpm test --filter merge
- pnpm test --filter cli
- pnpm test --filter telemetry

### 4.2 ゲート条件
- Phase A: S-A0〜S-A2成功、P95 ≤ 2.5s, 復旧成功率 ≥ 99.5%
- Phase B: S-A3成功、自動マージ率 ≥ 80%
- ロールバック対応: TelemetryのSLO違反を検出時、CLIスナップショットと rollback.md の整合を再検証。