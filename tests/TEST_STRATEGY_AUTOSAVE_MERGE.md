# AutoSave / Diff Merge テスト戦略

## 1. 目的
- `docs/IMPLEMENTATION-PLAN.md` の TDD チェックリスト 6 項目を起点に、AutoSave・Diff Merge・CLI/Collector の後方互換を証跡化する試験の全体像を同期する。【F:docs/IMPLEMENTATION-PLAN.md†L108-L139】
- 既存ディレクトリ別の試験計画（`tests/*/TEST_PLAN.md`）を横串に整理し、Phase A/B ロールアウトのゲート条件を明確化する。【F:tests/autosave/TEST_PLAN.md†L1-L78】【F:tests/merge/TEST_PLAN.md†L1-L78】【F:tests/cli/TEST_PLAN.md†L1-L80】【F:tests/telemetry/TEST_PLAN.md†L1-L55】

## 2. tests/ ディレクトリ別ケース表
| ディレクトリ | ユニット試験 (TDD 対応項目) | 統合/スナップショット試験 | 備考 |
| --- | --- | --- | --- |
| `tests/autosave` | AS-U-01: フラグ OFF で手動保存のみ呼ばれることを確認 (TDD#1) / AS-U-02: AutoSave ランナー起動 (TDD#2) / AS-U-03: localStorage 上書き優先 (TDD#2)【F:tests/autosave/TEST_PLAN.md†L17-L25】 | AS-I-01: 復旧フロー不発 (TDD#1) / AS-I-02: Idle 2s 後の OPFS 書き込み + Collector 通知 (TDD#2) / AS-I-03: ロック衝突フォールバック (TDD#2)【F:tests/autosave/TEST_PLAN.md†L17-L25】 | OPFS 書き込み・ロックモックを `tests/fixtures/autosave` に集約し、`MockStoryboard`・`MockWebLock` を共有する。【F:tests/autosave/TEST_PLAN.md†L28-L72】 |
| `tests/merge` | MD-U-01: legacy でタブ不変 (TDD#3) / MD-U-02: beta で Diff Merge タブ追加 (TDD#4) / MD-U-03: stable で `merge3` パラメータ検証 (TDD#4)【F:tests/merge/TEST_PLAN.md†L17-L25】 | MD-I-01: 既存ショートカット維持 (TDD#3) / MD-I-02: Diff Merge タブで後方互換 (TDD#4) / MD-V-01: タブラベルのビジュアル比較【F:tests/merge/TEST_PLAN.md†L17-L44】 | `MockMergePackage` と重み付けスナップショットを `tests/fixtures/merge` に保管し、`beta`/`stable` の差分を JSON 化。【F:tests/merge/TEST_PLAN.md†L28-L52】 |
| `tests/cli` | CC-U-01: AutoSave OFF + legacy で JSON 出力一致 (TDD#5) / CC-U-02: AutoSave ON + beta メタ保持 (TDD#5) / CC-U-03: AutoSave ON + stable 出力構造維持 (TDD#5)【F:tests/cli/TEST_PLAN.md†L17-L33】 | CC-I-01: `buildPackage`→Collector ingest 連携 (TDD#5) / CC-S-01: Flag 行列別スナップショット (TDD#5)【F:tests/cli/TEST_PLAN.md†L17-L33】 | CLI 標準出力・成果物ハッシュを `__snapshots__/cli/{matrix}` へ保存し、Collector エンベロープを JSON Schema で検証。【F:tests/cli/TEST_PLAN.md†L34-L70】 |
| `tests/telemetry` | - | T1: 保存遅延 P95 / T2: 復旧成功率 / T3: 自動マージ率 / T4: ロック再試行 / T5: SLO 通知経路 (いずれも TDD#6)【F:tests/telemetry/TEST_PLAN.md†L8-L33】 | JSONL フィクスチャを `tests/fixtures/telemetry` に配置し、Analyzer/Reporter モックで SLO 判定を再現。【F:tests/telemetry/TEST_PLAN.md†L35-L55】 |

## 3. フラグシナリオと必要モック/フィクスチャ
### 3.1 AutoSave / Diff Merge フラグ組み合わせ
| シナリオ ID | `autosave.enabled` | `merge.precision` | 主担当ディレクトリ | 使用モック/フィクスチャ | 目的 |
| --- | --- | --- | --- | --- | --- |
| S-A0 | OFF | legacy | `tests/autosave`, `tests/cli` | `MockStoryboard` (初期状態), `ManualSaveShortcutMock`, CLI スナップショット既存版 | 既存保存・CLI 出力が完全一致する基準ラインの確立 (TDD#1,#3,#5)。【F:tests/autosave/TEST_PLAN.md†L17-L25】【F:tests/merge/TEST_PLAN.md†L17-L25】【F:tests/cli/TEST_PLAN.md†L17-L33】 |
| S-A1 | ON | legacy | `tests/autosave`, `tests/telemetry` | `MockWebLock` (取得成功), `MockFileLock` (未使用), `AutoSaveTelemetryEvent` JSONL | AutoSave 起動と Collector へのイベント送信経路を確認 (TDD#2,#6)。【F:tests/autosave/TEST_PLAN.md†L28-L72】【F:tests/telemetry/TEST_PLAN.md†L8-L33】 |
| S-A2 | ON | beta | `tests/merge`, `tests/cli`, `tests/telemetry` | `MockMergePackage` (Diff Merge 用差分), CLI `FlagMatrix('ON+beta')`, Telemetry `merge.diff.apply` JSONL | Diff Merge タブ導線と CLI 追加メタの互換性を検証 (TDD#4,#5,#6)。【F:tests/merge/TEST_PLAN.md†L17-L52】【F:tests/cli/TEST_PLAN.md†L17-L60】【F:tests/telemetry/TEST_PLAN.md†L8-L33】 |
| S-A3 | ON | stable | `tests/merge`, `tests/cli`, `tests/telemetry` | `MockMergePackage` (安定スコアリング), CLI `FlagMatrix('ON+stable')`, `CollectorEnvelope` (`autosave`/`merge` エントリ混在) | 精緻マージスコアと CLI/Collector スキーマの最終形を固定 (TDD#4,#5,#6)。【F:tests/merge/TEST_PLAN.md†L17-L52】【F:tests/cli/TEST_PLAN.md†L17-L70】【F:tests/telemetry/TEST_PLAN.md†L8-L33】 |
| S-A4 | ON | legacy (ロック衝突) | `tests/autosave`, `tests/telemetry` | `MockWebLock` (失敗シナリオ), `MockFileLock` (フォールバック取得), `autosave.lock.error` JSONL | Web Lock フォールバックと SLO アラート経路の耐性検証 (TDD#2,#6)。【F:tests/autosave/TEST_PLAN.md†L17-L72】【F:tests/telemetry/TEST_PLAN.md†L24-L33】 |

### 3.2 CLI 互換性補足
| ケース | 依存フラグ | 追加モック/フィクスチャ | チェックポイント |
| --- | --- | --- | --- |
| CLI-JS-01 | S-A0 | 既存 JSON スナップショット, `sha256` ハッシュ表 | `downloadText` 出力がビット単位で一致 (CC-U-01)。【F:tests/cli/TEST_PLAN.md†L17-L33】 |
| CLI-JS-02 | S-A2 | `FlagMatrix('ON+beta')` 用スナップショット, `CollectorEnvelope` バリデータ | AutoSave メタ追加時でも `schemaVersion`=1.7 を維持 (CC-U-02/CC-I-01)。【F:tests/cli/TEST_PLAN.md†L17-L60】 |
| CLI-JS-03 | S-A3 | `FlagMatrix('ON+stable')` スナップショット, `merge` スコア統計モック | 精緻マージ統計が `payload` ネームスペースに封じ込められ CLI 破壊を回避 (CC-U-03/CC-S-01)。【F:tests/cli/TEST_PLAN.md†L17-L70】 |

## 4. テスト実行コマンドとゲート条件
### 4.1 推奨コマンドシーケンス
1. `pnpm lint` — Node 環境で ruff 等価の静的解析を実施。【F:tests/autosave/TEST_PLAN.md†L74-L78】
2. `pnpm typecheck` — `tsc --noEmit` により型安全性を担保。【F:tests/autosave/TEST_PLAN.md†L74-L78】
3. `pnpm test --filter autosave` — AutoSave フラグ ON/OFF のユニット/統合を検証。ピンポイントでの再現には `pnpm test -- tests/lib/autosave/init.test.ts tests/lib/autosave/scheduler.test.ts` を利用。【F:tests/autosave/TEST_PLAN.md†L74-L78】
4. `pnpm test --filter merge` — Diff Merge タブとスコアリングの差分を確認。【F:tests/merge/TEST_PLAN.md†L54-L60】
5. `pnpm test --filter cli` → `pnpm test --filter collector` — CLI 出力と Collector 経路をフラグ行列別にチェック。【F:tests/cli/TEST_PLAN.md†L62-L80】
6. `pnpm test --filter telemetry` — JSONL から SLO 判定までを再現。【F:tests/telemetry/TEST_PLAN.md†L8-L55】
7. `rm -rf coverage && pnpm -s test:coverage` / `pnpm test -- --test-reporter junit --test-reporter-destination reports/junit.xml` — スナップショット更新前と CI レポート収集時に実施。前者は `coverage/` を初期化してから実行することで JUnit 生成ステップに副作用を残さない。【F:tests/autosave/TEST_PLAN.md†L74-L78】【F:tests/cli/TEST_PLAN.md†L62-L80】

### 4.2 ゲート条件
- **Phase A ロールアウト**: `S-A0`〜`S-A2` のケースが全て緑で、`autosave.save.completed` の P95 ≤ 2.5s, 復旧成功率 ≥ 99.5%。【F:docs/IMPLEMENTATION-PLAN.md†L118-L130】【F:tests/telemetry/TEST_PLAN.md†L15-L27】
- **Phase B ロールアウト**: `S-A3` の精緻マージ統合と CLI/Collector 互換ケース (CLI-JS-02/03) が緑で、自動マージ率 ≥ 80%。【F:docs/IMPLEMENTATION-PLAN.md†L118-L133】【F:tests/telemetry/TEST_PLAN.md†L20-L27】
- **ロールバック判定**: Telemetry テストで SLO 違反イベントが出力された場合、`tests/cli` スナップショットと `templates/alerts/rollback.md` の整合を再検証した上で `flags:rollback` 実行フローに従う。【F:docs/IMPLEMENTATION-PLAN.md†L86-L107】【F:tests/telemetry/TEST_PLAN.md†L28-L55】

