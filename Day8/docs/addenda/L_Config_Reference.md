# Day8 設定リファレンス（Appendix L）

Day8 を導入・運用する際に必要となる環境変数、設定ファイル、デバッグフラグを一覧化した付録です。Appendix H（デプロイガイド）と ops 手順のあいだで迷いやすい初期設定を一箇所で把握できるよう整理しています。

## 環境変数チェックリスト

| 変数 | スコープ | 既定値/例 | 説明 | 出典 |
| --- | --- | --- | --- | --- |
| `DAY8_GITDIR` | ローカル運用 | `C:\Users\<user>\gitdirs\Day8.git` | `.git` を外出しする運用で Git メタデータを束ねるための必須変数。 | [ops/04_ops.md](../day8/ops/04_ops.md) |
| `DAY8_WORK` | ローカル運用 | `C:\Users\<user>\Downloads\...\Day8` | ワークツリーのパス。`DAY8_GITDIR` とセットで Git 操作エイリアスから参照する。 | [ops/04_ops.md](../day8/ops/04_ops.md) |
| `GITHUB_OUTPUT` | GitHub Actions | 自動 | ステップ間で成果物パスを共有する GitHub 提供の予約変数。Day8 では反省レポートや Issue 下書きのパス共有に使用。 | [day8/examples/10_examples.md](../day8/examples/10_examples.md) |
| `GITHUB_ENV` | GitHub Actions | 自動 | 後続ステップへ環境変数を引き継ぐ。`REPORT_PATH` など Day8 専用の派生変数を書き込む。 | [day8/examples/10_examples.md](../day8/examples/10_examples.md) |
| `REPORT_PATH` / `ISSUE_CONTENT_PATH` / `ISSUE_HASH_PATH` | GitHub Actions 派生 | `reports/today.md` など | `GITHUB_OUTPUT`/`GITHUB_ENV` に流し込み、レポートの git add・Issue 草案コミットを安定化。 | [day8/examples/10_examples.md](../day8/examples/10_examples.md) |
| `PR_BODY` | CI ユーティリティ | なし | ガバナンスゲート検証時に Pull Request 本文を直接渡すための任意入力。 | [tools/ci/check_governance_gate.py](../../tools/ci/check_governance_gate.py) |
| `GITHUB_EVENT_PATH` / `GITHUB_EVENT_NAME` | CI ユーティリティ | GitHub が設定 | ガバナンスゲートがイベント JSON を解釈する際に利用。ローカル検証では未設定の場合があるため注意。 | [tools/ci/check_governance_gate.py](../../tools/ci/check_governance_gate.py) |
| `PYTHONDONTWRITEBYTECODE` / `PYTHONUNBUFFERED` | Docker サンプル | `1` | Appendix H の Dockerfile で使用。CI 用コンテナで `.pyc` 生成抑制とログ即時出力を保証。 | [addenda/H_Deploy_Guide.md](H_Deploy_Guide.md) |

> **導入前テスト:** まず ops 手順の `day8` エイリアスを設定し、`day8 status` で GitDir と Worktree が正しく紐づくか確認してください。その後 GitHub Actions サンプルワークフローの `Determine reflection outputs` ステップが `REPORT_PATH` を出力するかをローカル `act` などで検証すると設定漏れを早期発見できます。

## 主要設定ファイル

| ファイル | 役割 | 主な項目 | 出典 |
| --- | --- | --- | --- |
| `.github/workflows/test.yml` / `reflection.yml` | CI トリガ | ログ生成と反省自動化を担当する Day8 標準ワークフロー。 | [day8/spec/02_spec.md](../day8/spec/02_spec.md) |
| `workflow-cookbook/reflection.yaml` | 反省 DSL | `targets`・`metrics`・`analysis`・`actions`・`report` を declarative に制御。`include_why_why` や `suggest_issues` など挙動を設定。 | [day8/spec/02_spec.md](../day8/spec/02_spec.md) |
| `workflow-cookbook/scripts/analyze.py` | レポート生成 | ログパス (`DEFAULT_LOG`)、レポートパス (`DEFAULT_REPORT`)、Issue 出力 (`ISSUE_OUT`) の既定値を持ち、Birdseye 同期のベース。 | [workflow-cookbook/scripts/analyze.py](../../workflow-cookbook/scripts/analyze.py) |
| `docs/birdseye/index.json` / `hot.json` | 可視化メタ | ドキュメント依存関係とホットリスト。`generated_at` を同期し、Appendix H チェックリストに含まれる。 | [birdseye/README.md](../birdseye/README.md) |
| `docs/addenda/H_Deploy_Guide.md` | デプロイ補助 | ローカル検証・Docker・GitHub Actions のチェックリストを保持。Appendix L と組み合わせて導入前後の差分確認を行う。 | [addenda/H_Deploy_Guide.md](H_Deploy_Guide.md) |

## デバッグフラグとトラブルシュート

| コマンド / フラグ | 利用シーン | 効果 | 出典 |
| --- | --- | --- | --- |
| `python workflow-cookbook/scripts/analyze.py --root . --emit report` | 導入前のローカル検証 | CI と同じ解析手順を手元で再現。`--root` で対象リポジトリを固定し、`--emit report` で Markdown 出力を生成。 | [addenda/H_Deploy_Guide.md](H_Deploy_Guide.md) |
| `--fail-on warnings` | リリース前の厳格チェック | Birdseye 未更新などの警告を CI で失敗扱いにする。 | [addenda/H_Deploy_Guide.md](H_Deploy_Guide.md) |
| `day8 status` / `day8 add .` など | 外部 git-dir 運用 | `DAY8_GITDIR`/`DAY8_WORK` を使った PowerShell エイリアスで Git 操作を標準化。 | [ops/04_ops.md](../day8/ops/04_ops.md) |

> **Why-Why の調査**: `include_why_why: true` と `suggest_issues: true` を組み合わせたままテストが失敗すると、`reports/issue_suggestions.md` が生成されます。コミット前に Birdseye Capsule が最新か確認し、必要なら Appendix L のチェックリストへ追記してください。

## シナリオ別参照ガイド

1. **導入前の環境構築チェック** — Appendix H の「開発環境フロー」を読みながら本付録の環境変数を網羅的に設定し、`python workflow-cookbook/scripts/analyze.py --root . --emit report --fail-on warnings` をローカルで一度実行する。 | [addenda/H_Deploy_Guide.md](H_Deploy_Guide.md)
2. **CI トラブル時の切り分け** — `test` / `reflection` ワークフローが失敗した場合、`REPORT_PATH` 等の派生変数を `GITHUB_STEP_SUMMARY` に出力して比較し、Appendix L の表と突き合わせる。 | [day8/examples/10_examples.md](../day8/examples/10_examples.md)
3. **Birdseye 再生成** — `docs/birdseye/index.json` と `hot.json` の `generated_at` を本付録で確認し、Appendix H のチェックリストを経て codemap ツールで再生成する。 | [birdseye/README.md](../birdseye/README.md)

---

- **更新トリガ**: 新しい環境変数や設定ファイルが Day8 に追加された場合は Appendix L に追記し、Birdseye (`index` / `hot` / Capsule) の依存関係を同時更新してください。
- **維持管理者**: Day8 運用チーム（ops）
