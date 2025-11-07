# 付録I: 検証シナリオカタログ（Workflow Cookbook）

| ケースID | シナリオ名 | 目的 | 参照資料 |
| :--- | :--- | :--- | :--- |
| I-01 | チェックリスト突合 | リリース可否判断の前に `CHECKLISTS.md` と成果物ログの整合を検証する。 | [`CHECKLISTS.md`](../../CHECKLISTS.md), [`README.md`](../../README.md#changelog-update-rules) |
| I-02 | Birdseye 再生成確認 | ドキュメント差分に応じた Birdseye インデックス/カプセルの再生成を検証する。 | [`tools/codemap/README.md`](../../tools/codemap/README.md#実行手順), [`docs/BIRDSEYE.md`](../BIRDSEYE.md) |
| I-03 | Task Seed TDD 例 | Task Seed で設計したテスト計画と実行ログが一貫しているか確認する。 | [`docs/TASKS.md`](../TASKS.md#3-検証ログtdd-前提), [`TASK.codex.md`](../../TASK.codex.md) |
| I-04 | コンテキストトリミング検証 | `trim_messages` の統計値とメタ情報が期待通りか確認する。 | [`tools/perf/context_trimmer.py`](../../tools/perf/context_trimmer.py), [`docs/addenda/D_Context_Trimming.md`](D_Context_Trimming.md) |

> **利用方法**: Workflow Cookbook 付録Iテンプレートに倣い、代表シナリオをケースID・目的・参照資料で管理する。追加が必要な場合は既存IDの連番で追記し、
> 実施ログや検証結果から逆引きできるようにする。

## I-01 チェックリスト突合

- **前提条件**
  - リリース対象の PR またはタスクで `CHECKLISTS.md` の対象セクションが特定済み。
  - 対応する変更履歴や配布物の記録が `README.md#changelog-update-rules` の手順で作成されている。
- **手順**
  1. `CHECKLISTS.md` の該当セクションを開き、未完了のチェック項目を抽出する。
  2. PR の説明、検証ログ、配布物チェックを確認し、各項目が実施済みであることを突合する。
  3. 未実施項目が残る場合は Follow-up として `docs/TASKS.md` の `Follow-ups` セクションへ追記する。
  4. すべて完了していればチェックリストを更新し、Evidence（ログ・スクリーンショット等）を添付する。
- **期待結果**
  - チェックリストの全項目が実施済みで、証跡が追跡可能になっている。
  - 未完了項目は明確なフォローアップ先が設定されている。

## I-02 Birdseye 再生成確認

- **前提条件**
  - ドキュメントやコードの構造差分が Birdseye に影響する可能性がある。
  - `python tools/codemap/update.py` を実行できる環境が整備されている。
- **手順**
  1. `tools/codemap/update.py --since --emit index+caps` を実行し、生成物を `docs/birdseye/` 配下に出力する。
  2. `git status` で生成物の差分を確認し、意図しない削除や大規模変更がないか検査する。
  3. `docs/BIRDSEYE.md` のホットリストや参照ガイドに変化が必要か判断し、必要な場合のみ最小限の追記を行う。
  4. 差分が期待通りであれば PR に生成コマンドと結果ログを添付し、Birdseye の鮮度維持を確認する。
- **期待結果**
  - Birdseye インデックスとカプセルが最新の構造を反映し、意図しない差分がないことをレビューで確認できる。
  - コマンド実行ログが PR や Task Seed に残り、再現手順が明確になっている。

## I-03 Task Seed TDD 例

- **前提条件**
  - 該当タスクの `Task Seed` が `docs/TASKS.md` のテンプレートに従って作成済み。
  - 想定テストコマンドと期待結果が `Tests` セクションへ事前記載されている。
- **手順**
  1. `Task Seed` の `Tests` セクションに列挙したコマンドを失敗→成功の順に実行し、ログを追記する。
  2. 実装差分を反映した後、再度同じテストを実行し、グリーンであることを確認する。
  3. 実行ログを `Task Seed` の `Verification` または `Notes` に貼付し、`EVALUATION.md` の受入基準を満たすか確認する。
  4. 追加で必要になった検証は `I-01` や `I-02` に従って派生タスクまたはフォローアップを記録する。
- **期待結果**
  - Task Seed に記載したテストがすべて成功し、ログが整合している。
- 追加検証が必要な場合はケースIDとリンク付きで記録され、追跡できる。

## I-04 コンテキストトリミング検証

- **前提条件**
  - `tools/perf/context_trimmer.trim_messages` を呼び出せる Python 実行環境が整備されている。
  - `tiktoken` が未導入の場合でもフォールバック挙動を確認できるよう、`pip uninstall tiktoken` などで一時的に除外する手順を把握している。
- **手順**
  1. `python - <<'PY'` で `trim_messages` を呼び出し、`max_context_tokens` を意図的に小さく設定して最新メッセージのみが保持されるケースを確認する。
  2. 同一スクリプト内で `semantic_options={"embedder": lambda text: [float(len(text))]}` を指定し、`semantic_retention` が 1.0 になることを確認する。
  3. 埋め込み関数が例外を投げるケース（例: `lambda _: (_ for _ in ()).throw(RuntimeError("fail"))`）を投入し、`semantic_retention` が 0.0 になることを確認する。
  4. `TokenCounter.meta()` の出力から `strategy` が `tiktoken` → `heuristic` へ切り替わるログを取得し、実行環境ごとに記録する。
- **期待結果**
  - `statistics` の `compress_ratio` と `compression_ratio` が同値で、計算式どおりの比率を示す。
  - `semantic_options` の指定有無に応じて `semantic_retention` が出力されたり省略されたりする挙動が再現される。
  - `_TokenCounter.meta()` の `strategy` と `uses_tiktoken` が環境に応じた値で記録される。
