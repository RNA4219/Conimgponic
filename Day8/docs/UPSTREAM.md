# Day8 Upstream 運用ガイド

Day8 リポジトリと Katamari ワークフロー資産を同期させるための Upstream 運用手順をまとめたガイドです。フォーク運用時に守るべきリモート定義、`git subtree` を用いた取り込み手順、週次の確認ポイントをここで統一します。Katamari 本家との差分を把握するときは、必ず先に [Day8 Fork Notes](FORK_NOTES.md) で Day8 固有の追加要素とライセンス同梱ルールを確認してから本ガイドに進んでください。

## 1. Upstream 定義

| 名称 | 役割 | URL/取得方法 | 備考 |
| --- | --- | --- | --- |
| `upstream` | Day8 の正規リポジトリ | `git@github.com:openai/day8.git` | `main` ブランチが単一のソース・オブ・トゥルース。リードのみ実行権限。 |
| `origin` | 個人またはチームのフォークリポジトリ | `git@github.com:<your-account>/day8.git` | フォーク先。PR 作成および検証用。`main` には直接 push しない。 |
| `workflow-cookbook` | Katamari ワークフロー資産の参照リポジトリ | `git@github.com:openai/workflow-cookbook.git` | `workflow-cookbook/` ディレクトリを `git subtree` で取り込む。読み取り専用。 |

> 初回セットアップ: `git remote add upstream git@github.com:openai/day8.git` / `git remote add workflow-cookbook git@github.com:openai/workflow-cookbook.git`

## 2. `git subtree` による同期手順

`workflow-cookbook/` 以下は Katamari 側の資産を Day8 に取り込むため、`git subtree` を用いた同期を必須とします。Squash 取り込みによりヒストリを簡潔に保ちます。

1. **最新の参照を取得する**
   ```bash
   git fetch upstream
   git fetch workflow-cookbook
   ```
2. **差分を確認する** — 取り込み対象ブランチ（通常 `main`）を指定し、差分を確認します。
   ```bash
   git subtree pull --prefix workflow-cookbook workflow-cookbook main --squash --rejoin --dry-run
   ```
3. **取り込みを実行する** — 差分を確認のうえ、`dry-run` を外して適用します。
   ```bash
   git subtree pull --prefix workflow-cookbook workflow-cookbook main --squash --rejoin
   ```
4. **Day8 への反映** — 取り込んだ差分を Day8 側へ調整します。必要に応じて `docs/ROADMAP_AND_SPECS.md`・`docs/birdseye/index.json`・`docs/birdseye/caps/` を同期し、CI (mypy / ruff / pytest / node:test) をローカルで実行してから PR を作成します。
5. **Katamari への逆同期（必要時）** — Day8 側で生じた修正を Katamari 基盤へ戻す際は `git subtree push --prefix workflow-cookbook workflow-cookbook <branch>` を利用し、Katamari 側でレビューを受けたうえでマージします。

> `--rejoin` を付与することで、サブツリー履歴の再結合が保証されます。エラーが発生した場合は `git subtree split` の結果と `workflow-cookbook` リモートの HEAD を照合し、再度 `--rejoin` を実行してください。

## 3. 週次チェックリスト

| 手順 | チェック項目 | 完了時の記録先 |
| --- | --- | --- |
| 1 | `git fetch upstream` / `git fetch workflow-cookbook` を実行し、最新コミットを取得した | 本ドキュメント最下部のログテンプレート（[UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md)）に週番号・取得コミットを記入 |
| 2 | `git subtree pull --dry-run` の結果を確認し、差分が想定通りかレビューした | 必要に応じて Issue/TASK を起票し、差分要約をログに追記 |
| 3 | 実行後の差分を `workflow-cookbook` ディレクトリと Day8 ドキュメントへ反映し、Birdseye (`docs/birdseye/index.json` / `caps/`) を更新した | PR 本文と [docs/BIRDSEYE.md](BIRDSEYE.md) の手順に沿って `generated_at` を同期、ログに PR 番号を追記 |
| 4 | CI (mypy / ruff / pytest / node:test) をローカルで実行し、失敗がないことを確認した | 実行日時と結果をログに残し、失敗時はフォローアップタスクを記録 |
| 5 | 週次レビューで差分を報告し、必要なフォローアップをアサインした | レビュー議事をログへ追記し、未完了項目にチェックを残す |

## 4. よくある課題と対処

- **subtree 取り込みでコンフリクトが発生した** — `git stash push` でローカル差分を退避し、`git subtree pull` を再試行。解消できない場合は Katamari 側の変更を確認し、PR へノートとして残します。
- **Birdseye の `generated_at` が揃っていない** — `docs/birdseye/index.json` と `docs/birdseye/hot.json` を同じタイムスタンプへ更新する。`docs/birdseye/README.md` の「更新順序」を参照すること。
- **週次ログの記録漏れ** — [UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md) に空行がある場合、翌週の冒頭で最新週の情報を補完し、レビューミーティングで共有する。

## 5. 参考リンク

- [Day8 ドキュメント索引](README.md)
- [Day8 ロードマップ & 仕様メモ](ROADMAP_AND_SPECS.md)
- [Birdseye 更新ガイド](birdseye/README.md)
- [Upstream 週次ログ テンプレート](UPSTREAM_WEEKLY_LOG.md)

> 更新時は本ガイドと [UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md) を同一 PR で変更し、索引用ドキュメントと Birdseye の整合性を保ってください。
