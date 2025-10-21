
# v1.3 実装計画（AutoSave & 精緻マージ）

## 0) 方針とフラグポリシー
- 既存スキーマ（`Storyboard`/`Scene`）は**不変**。新規ファイルは OPFS に追加。
- 既存 UI の動線は維持。新規は**タブ**/小パネルとして追加。
- フラグで段階導入し、**機能別に既定値・観測指標・ロールバック条件を定義**する。

### 0.1 フラグ定義
- `autosave.enabled`
  - 既定値: Phase A まで `false`。
  - 目的: `App.tsx` の AutoSave ランナー初期化可否。
  - 切替手段: `import.meta.env.VITE_AUTOSAVE_ENABLED` → `localStorage.autosave.enabled` → `docs/CONFIG_FLAGS.md` 既定値。
- `merge.precision`
  - 既定値: Phase B 前は `legacy`（=既存マニュアル/AI 優先ロジック）。
  - 目的: `MergeDock.tsx` の Diff Merge タブ提示とマージ器の精度モード切替。
  - 切替手段: `import.meta.env.VITE_MERGE_PRECISION` → `localStorage.merge.precision` → `docs/CONFIG_FLAGS.md` 既定値。

### 0.2 設定ソースマッピング
| Consumer | Primary Source | Secondary | Fallback/備考 |
| --- | --- | --- | --- |
| `App.tsx` | `src/config/flags.ts`（新設: env→localStorage→既定値を解決） | `localStorage` 直接参照（後方互換） | `docs/CONFIG_FLAGS.md` の `autosave.enabled` を既定として AutoSave 起動判定に利用 |
| `MergeDock.tsx` | `src/config/flags.ts` から `merge.precision` を取得 | `localStorage`（既存 `dockOpen` と並列運用） | 既定 `legacy` で Diff Merge タブを隠蔽し、Phase B 以降に `beta/stable` で解放 |
| 共通 | `src/config/index.ts`（`OLLAMA_BASE` など既存値） | - | `App.tsx` では現行の `OLLAMA_BASE` 読み込みフローを保持し、副作用を隔離 |

## 1) 対象モジュール追加
- `src/lib/autosave.ts`（API・イベント・ローテ）
- `src/lib/locks.ts`（Web Locks + フォールバック）
- `src/lib/merge.ts`（3-way・スコア・決定化）
- `src/components/AutoSaveIndicator.tsx`（UI/履歴）
- `src/components/DiffMergeView.tsx`（衝突解消UI）
- 既存更新: `MergeDock.tsx`（Diff Mergeタブ追加）, `App.tsx`（AutoSave起動）

### ロックモジュール要件整理
- **Web Lock 取得を優先**: `navigator.locks.request('imgponic:project', { mode: 'exclusive' })` を基本とし、TTL はブラウザ依存のためリース更新 API を内製する（`docs/AUTOSAVE-DESIGN-IMPL.md` §3.1）。
- **フォールバックの責務**: Web Lock が利用不可または衝突検出時は `project/.lock` を用いて UUID・`mtime`・TTL(30s) を同期する（同 §3.3）。
- **失敗時の挙動**: ロック取得が最終的に失敗した場合は閲覧専用モードへ移行し、UI へ警告イベントを伝播する（同 §3.4）。
- **Collector/Analyzer との干渉防止**: Lock ファイルは `project/` 配下に限定し、`workflow-cookbook/` や `logs/` など Day8 系アーティファクトには触れない（`docs/day8/design/03_architecture.md`）。

#### `src/lib/locks.ts` 公開 API と想定利用者
| API | 役割 | 想定利用者 |
| --- | --- | --- |
| `acquireProjectLock(opts?: AcquireLockOptions): Promise<ProjectLockLease>` | Web Lock 取得 → フォールバック取得までをラップ。リース UUID・期限を返す。 | AutoSave 初期化、将来のバッチ系ジョブ（例: 精緻マージの事前計算） |
| `renewProjectLock(lease: ProjectLockLease): Promise<ProjectLockLease>` | TTL 満了前に Web Lock もしくはフォールバックの `mtime` を更新。 | AutoSave の心拍タイマー、長時間実行する編集系機能 |
| `releaseProjectLock(lease: ProjectLockLease): Promise<void>` | Web Lock 解放とフォールバックファイル削除を保証。 | AutoSave 終了、手動保存完了フック |
| `withProjectLock<T>(fn: (lease: ProjectLockLease) => Promise<T>, opts?: AcquireLockOptions): Promise<T>` | 取得→処理→解放のオーケストレーションを簡略化。 | CLI 連携や将来のエクスポート機能 |
| `subscribeLockEvents(listener: (event: ProjectLockEvent) => void): () => void` | ロック状態変化（取得成功/競合/再試行失敗）を UI・テレメトリへ通知。 | AutoSaveIndicator、後続の監査ログ収集 |

> **備考**: API のオプション型・イベント型は `strict`/`mypy` 相当の型安全を維持し、再試行可否を識別するフラグを含める。

## 2) ロールアウト
- **Phase A**: AutoSave（既定OFF→内テスト→既定ON）
- **Phase B**: 精緻マージ（beta→stable）。従来の manual-first/ai-first を残す。
## 2) ロールアウトロードマップ

### 2.1 フェーズ表
| フェーズ | 期間 (想定) | `autosave.enabled` | `merge.precision` | 対象ユーザー | エントリー条件 | ロールバック条件 |
| --- | --- | --- | --- | --- | --- | --- |
| Phase A-0 | Week 0 | `false` | `legacy` | 全ユーザー | 既存機能安定を確認 | AutoSave 起動時に保存遅延 >2.5s が 3 回/日 以上 |
| Phase A-1 | Week 1 (内テスト) | `true` (QA のみ) | `legacy` | 開発チーム/QA | テレメトリで保存時間 P95 ≤2.5s | P95>2.5s または復旧失敗率>1% |
| Phase A-2 | Week 2 (段階ON) | `true` | `legacy` | ベータ招待 | QA 完了＋復元テスト合格 | 復元失敗>0.5% or クラッシュ頻度増>5% |
| Phase B-0 | Week 3 | `true` | `beta` | ベータ招待 | AutoSave 安定化＋Diff Merge β準備完了 | 自動マージ率<80% or 重大バグ報告>3件 |
| Phase B-1 | Week 4 (beta→stable 切替) | `true` | `stable` | 全ユーザー | マージ SLO 達成（下記参照） | 自動マージ率<80% が 2 日継続 or SLO 未達 |

### 2.2 SLO とメトリクス
- 保存時間: AutoSave 保存完了まで P95 ≤2.5s。
- 復旧性能: 強制終了後の復元成功率 ≥99.5%、復旧まで ≤5s。
- 自動マージ率: Diff Merge 適用ケースで自動確定率 ≥80%。
- モニタリング: `Collector`→`Analyzer`→`Reporter` パイプラインで保存時間/マージ率/SLO 違反を集計し、`governance/policy.yaml` のしきい値でアラートを発報。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】

### 2.3 ロールバックポリシー
- いずれかの SLO を 24h 以内に復旧できない場合、前フェーズのフラグ値へ即時ロールバック。
- ロールバック後は原因分析（Collector 集計→Analyzer レポート）を 1 営業日以内に共有し、再開時は Canary（QA のみ）から再スタート。

## 3) 工数（概算）
- AutoSave 実装 1.5–2.0 人日 + UI 0.5
- マージエンジン 2.0 人日 + UI 1.0 + ログ統合 0.5
- 試験（両機能） 1.0
**合計: 6.5〜7.0 人日/1名**

## 4) 受入基準（要約）
- AutoSave: 入力停止 ≤2.5s で保存。強制終了→起動で ≤5s 前の復元。
- マージ: ラベル付きケースで自動マージ率 ≥80%、再実行で決定的。

## 5) ロック運用チェックリスト
- [ ] `project/.lock` 以外に Day8 の Collector/Analyzer が参照する `workflow-cookbook/` 以下のパスを作成しない（`docs/day8/design/03_architecture.md`）。
- [ ] Lock 関連ログは `reports/`・`logs/` ではなく `project/autosave/` に限定し、Collector の JSONL 収集に影響させない（`docs/Architecture_ASCII.md`）。
- [ ] AutoSave UI から送出するイベント名は Day8 既存のメトリクス命名（`docs/day8/spec/01_requirements.md` の Observation Channel）と衝突しないプレフィックス（例: `autosave.lock.*`）を採用する。
- [ ] 強制解放や TTL 満了によるロック解放時は Analyzer が期待する `reports/` 配下の生成物を変更しないことを確認する。
## 5) 回帰試験計画（TDD チェックリスト）
- [ ] フラグ OFF (`autosave.enabled=false`) で既存保存ショートカット/手動保存が回帰しない（`App.tsx` キーバインド、OPFS 保存 2 種）。
- [ ] フラグ ON で AutoSave ワーカーが起動し、アイドル 2s 後に OPFS へ書き込みが行われるユニットテスト。
- [ ] フラグ OFF (`merge.precision=legacy`) で MergeDock のタブ構造（Compiled/Shot/Assets/Import/Golden）が不変。
- [ ] フラグ ON (`merge.precision=beta|stable`) で Diff Merge タブが追加され、手動/AI 優先セレクタとの後方互換テストを通過。
- [ ] CLI/JSON エクスポート（`downloadText`, `buildPackage`）がフラグ状態にかかわらずバイナリ互換であることをスナップショットテストで検証。
- [ ] `Collector` へのテレメトリ送信がフラグ ON/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。

## 6) Telemetry / ログ監視とエラー通知
- AutoSave/Diff Merge のイベントは既存 Collector JSONL チャネルに `feature` タグを付与し、Analyzer が SLO を算出できるよう拡張する。【F:Day8/docs/day8/design/03_architecture.md†L1-L31】
- 保存遅延・マージ失敗は `Reporter` の日次サマリに集約し、Governance が方針判断できるようにする。
- 例外発生時は `Collector` 側で再試行可否を判定（IO エラー=再試行可、ロジックエラー=即通知）し、Slack Webhook への警告と GitHub Issue Draft を自動生成。
- 監視項目: 保存時間 P95、保存失敗率、自動マージ率、手動ロールバック発生数、Telemetry キュー滞留時間。

## 7) 実装前のコード調査
- `App.tsx`: 初期化処理（`useEffect` キーバインド、`useState` 初期化）へフラグ連携ポイントを挿入できるか確認。
- `MergeDock.tsx`: 既存タブ構造と `pref` ステートを分析し、新規 Diff Merge タブ追加時に 200 行以内/差分 1 ファイルで収まるかを検証。
- `src/config.ts` と予定する `src/config/flags.ts`: env/localStorage/既定値の優先順位と後方互換性の影響を確認。
- 上記調査で差分が `App.tsx`・`MergeDock.tsx` の 2 ファイル以内に収まる見込みなら実装続行。スコープ超過が判明した場合はタスク分割を別途起票。
## 5) 精緻マージ 要約
- 対象API: `merge3(MergeInput, MergeProfile)` が hunk と統計を返却し、`MergeHunk` でセクション単位の決定を提供する。
- 性能: 100カット（セクション有り）で 5 秒以内の処理時間を達成する。
- 受入: lock と `prefer` を尊重した上で自動マージ率 80%以上、再実行で同一結果になること。
