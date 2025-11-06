# 貢献ガイド（Contributing）

## ブランチ/PR ルール
- 1タスク=1ブランチ=1PR（±300行/≤3ファイルを目安）
- Birdseye の `generated_at` 連番は PR ごとに 1 回だけ進め、index / hot / 関連カプセルを必ず同時更新する（1PR 原則）。
- レビュー前・マージ前に rebase で追従
- 公開 API/スキーマ変更は先行PR（契約合意）
- `Day8/workflow-cookbook/GUARDRAILS.md` に従い、テストを先に書く TDD（RED→GREEN→リファクタ）の実行ログを PR の `Tests` セクションに明記する。

### Guardrails の目的と基本制約
- Guardrails は Day8 / Katamari 双方の安全基準とスコープ制御を統一し、Birdseye・TASKS・リリースチェックリスト間の参照整合を保証する運用ハブである。作業開始前に [`workflow-cookbook/GUARDRAILS.md`](../../workflow-cookbook/GUARDRAILS.md) を読み直し、対象ドメインの制約と参照手順を把握してから Seed/PR を切る。
- Guardrails のスコープ上限ルール（1 回の変更は合計 100 行または 2 ファイルまで、単一ファイルが 400 行を超えたら責務分割を検討）を常に適用し、分割が必要な場合は Seed で背景と分割方針を共有してから実装に入る。
- 1タスク=1PR 原則では、Seed・ブランチ名・PR タイトルに共通の `<slug>` を付ける。フォローアップが必要になった場合は Seed の `Follow-up` を更新し、新しい Seed（`docs/seeds/TASK.<slug>-YYYY-MM-DD.md`）へ切り出す。

### TDD 先行追加の必須手順
1. 影響調査: Guardrails と関連ドキュメント（Birdseye・TASKS・Release Checklist）を読み、既存テストのカバレッジと再利用可否を確認する。
2. RED: 期待する振る舞いを満たさないテストを追加し、`pnpm test` / `pytest` / `node --test` など該当スイートで失敗を確認する。Seed の `Tests` に失敗ログを貼り、PR テンプレートの `Tests` セクションにも転記する。
3. GREEN: 必要最小限の実装でテストを通し、`workflow-cookbook/GUARDRAILS.md` の 400 行上限を超えないことを確認する。副作用の隔離ルールに従い、ドメイン層→IO 層→UI 層の順で改修する。
4. リファクタ: Guardrails の命名・責務分離ポリシーに従い整理し、再テスト後に Seed の `Tests` / `Commands` / `Notes` を更新する。Birdseye の `generated_at` はこのタイミングで 1 回だけ進める。

### 「1タスク=1PR」運用補足
- Guardrails のスコープ上限を超える見込みがある場合、Seed の `Follow-up` に分割案を列挙してから一旦コミットを止める。差分が 3 ファイルを超える場合は `docs/TASKS.md` へタスクを登録し、別 Seed による段階的移行へ切り替える。
- 途中で要件変更が発生したときは、Seed と PR の `Plan` / `Notes` に変更点を追記し、Birdseye `hot.json` の該当ノードにリスクを追加してから再レビューを依頼する。

## タスク化（衝突回避）
- タスクは独立性が保てる粒度まで分割し、責務の重複（コンフリクト）を避ける。
- 変更は小さく・短時間で終わるブランチとして切り、早めの rebase で常に最新に追従する。
- リスクや重なりがある場合は **Task Seeds**（ガイド: [`docs/TASKS.md`](../../TASKS.md) / 保存先: `docs/seeds/TASK.<slug>-YYYY-MM-DD.md`）を作成し、Katamari テンプレートの「背景/手順/検証ログ/フォローアップ」各セクションを埋めてから作業を開始する。

## Task Seed 作成フロー
1. `docs/TASKS.md` に新規タスクを追加し、Guardrails の制約と既存タスクとの衝突有無を記録する。
2. [`Day8/docs/seeds/README.md`](../../seeds/README.md) の Katamari テンプレートに従い、`docs/seeds/TASK.<slug>-YYYY-MM-DD.md` を作成する。背景・目的・完了条件・想定リスクを明文化し、Birdseye のどのノードを更新するかを明記する。
3. TDD の RED ログと再現手順を Seed の `Tests` / `Commands` に先に記入する。実装後は GREEN ログと使用コマンドを追記し、PR の `Tests` セクションへ転記する。
4. 作業完了後は Seed の `Follow-up` に残課題を列挙し、必要なら新しい Seed を `docs/seeds/` 以下に作成する。

### フォローアップチェックリスト
- [ ] Guardrails / ROADMAP / Birdseye の参照整合が取れているか（`docs/birdseye/index.json`・Capsule を確認）。
- [ ] 追加したテストの RED→GREEN ログが Seed と PR の両方で確認できるか。
- [ ] Release Checklist 該当項目（セキュリティ・運用など）の追跡が必要な場合、`docs/Release_Checklist.md` のリンクを Seed `Notes` へ追加したか。
- [ ] フォローアップがある場合、`docs/TASKS.md` と次の Seed の `背景` にハンドオフ内容が書かれているか。

## 最小差分・TDD
- `workflow-cookbook/HUB.codex.md` のタスク分割ルールに従い、1 Seed あたり 0.5 日以内で完結する作業だけを扱う。Public API へ影響する場合は事前に移行計画を記録し、Task Seed と PR 両方で共有する。
- `docs/TASKS.md` の Plan/Patch/Tests/Commands/Notes を逐次更新し、レビュー前に検証ログとローカルコマンドの成功結果を揃える。
- 実装は TDD を徹底し、RED テスト→実装→GREEN→リファクタの順で進める。テストの実行ログは Task Seed の Tests セクションおよび PR ノートへ転記する。

## Birdseye 同期手順
1. 差分把握: Guardrails や Day8 ドキュメントを更新したら、[`docs/birdseye/index.json`](../../birdseye/index.json) で対象ノードとエッジを特定する。
2. インデックス更新: `nodes[*].mtime` と `caps` パスを最新化し、`generated_at` を 1 回だけ次の連番へ進める。併せて該当 Capsule（例: `docs/birdseye/caps/docs.day8.guides.07_contributing.md.json`）を更新し、保守手順とリスクを明記する。
3. スクリプト活用: Birdseye 更新は `python workflow-cookbook/tools/codemap/update.py --targets docs/birdseye/index.json --emit index+caps` で自動適用できる。複数 shard を編集した場合は `python workflow-cookbook/tools/codemap/merge_index.py --index docs/birdseye/index.json --write` で集約ファイルを再生成する。
4. フォールバック: 自動スクリプトが使えない場合は [`docs/birdseye/README.md`](../../birdseye/README.md) と [`docs/BIRDSEYE.md`](../../BIRDSEYE.md) の手順に従い、index → caps → hot の順で手動更新する。`generated_at` がずれたら `hot.json` と合わせて同じ値に揃える。
5. 検証: Birdseye 更新後に `pnpm lint --filter docs` を実行し、フォーマットとリンク切れがないことを確認する。必要に応じて対象ノードのテスト（例: `tests/birdseye/*.spec.ts`）を追加で走らせる。
