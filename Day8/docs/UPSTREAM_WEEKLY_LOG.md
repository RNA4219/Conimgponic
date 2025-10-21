# Day8 Upstream 週次ログ テンプレート

Day8 と Katamari の差分同期を定期的に記録するための表形式テンプレートです。週次レビュー後に必ず更新し、未完了の対応は次週の冒頭でフォローアップしてください。

| 週番号 (ISO) | 実施日 | upstream commit (SHA) | Day8 sync commit (SHA) | 主な差分・対応内容 | Birdseye/ドキュメント同期状況 | 追加アクション・Owner | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-W01 | yyyy-mm-dd | `<sha>` | `<sha>` | Katamari から取り込んだ変更点を要約 | `index.json` / `caps` / `hot.json` の更新有無を記録 | 必要なフォローアップタスクと担当者 | レビューで決まった事項を記載 |
| 2025-W02 | yyyy-mm-dd | `<sha>` | `<sha>` |  |  |  |  |
| 2025-W03 | yyyy-mm-dd | `<sha>` | `<sha>` |  |  |  |  |
| ... | ... | ... | ... | ... | ... | ... | ... |

## 記入ルール

1. 週番号は ISO 8601 (例: 2025-W09) で記録する。
2. `upstream commit` は `git ls-remote upstream main` などで確認した最新 SHA を記入する。
3. `Day8 sync commit` には Day8 側の取り込みコミット (PR merge commit) を記入する。
4. 差分対応で未完了項目がある場合は `追加アクション・Owner` の列に追記し、完了するまで維持する。
5. ログ更新前に [Day8 Fork Notes](FORK_NOTES.md) の差分反映状況を確認し、追加依存やライセンス同梱に影響があれば本テンプレートへメモする。
6. ログ更新と同時に [docs/UPSTREAM.md](UPSTREAM.md) のチェックリスト項目と Birdseye の `generated_at` を確認する。
