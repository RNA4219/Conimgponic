# Safety ハブ（Day8）

`workflow-cookbook/SAFETY.md` を一次ハブ、`docs/addenda/G_Security_Privacy.md` を補助付録として参照し、Day8 における安全配慮・倫理判断の動線をまとめる。自動化は検知とレポートに限定し、本番影響のある判断は人間責任者が必ず確認する。

## 1. ドキュメント体系
- **一次ハブ**: [workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md) — Katamari 本家と整合した安全審査フレーム。
- **セキュリティ接続**: [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md) / [docs/day8/security/05_security.md](day8/security/05_security.md) — 技術的な緩和策とチェックリスト。
- **一次切り分け**: [docs/addenda/J_Runbook.md](addenda/J_Runbook.md) — Day8 代表事象の一次切り分けと初動整理。
- **付録**: [docs/addenda/G_Security_Privacy.md](addenda/G_Security_Privacy.md) — キー管理・ログ衛生・通信保護の運用ノート。
- **索引用**: [docs/ROADMAP_AND_SPECS.md](ROADMAP_AND_SPECS.md) / [docs/README.md](README.md) — Birdseye 更新と cross-doc 整合のエントリポイント。

## 2. フェイルセーフ
- 自動化は **観察→レポート→Issue 起票** に限定し、`src/**` / `infrastructure/**` / `secrets/**` の直接変更は禁止。
- 重大度 S1/S2 を検知したら即時で自動化を停止し、`workflow-cookbook/SAFETY.md` の緊急フローに沿って人間レビューへ切り替える。
- Birdseye Hot リストへ緊急タグを追加し、復旧後は `docs/birdseye/hot.json` の履歴に移動。
- フェイルセーフ発動時は `workflow-cookbook/logs/` に事象・判断者・暫定措置を記録し、`workflow-cookbook/reports/` へ 48 時間以内に RCA を登録。

## 3. 例外手続き
- Guardrails 例外は `workflow-cookbook/GUARDRAILS.md` のテンプレートに沿って起票し、承認者・期間・監視手段を明記。
- 承認済み例外は `workflow-cookbook/SECURITY.md` の例外一覧と本ドキュメントへリンクし、期限前リマインダーを Birdseye Capsule に追加。
- 安全面の追加検証が必要な場合は `workflow-cookbook/SAFETY.md` の審査会議ノートへ追記し、`docs/addenda/G_Security_Privacy.md` で保守方法を更新。
- 例外終了時は `docs/ROADMAP_AND_SPECS.md` のステップ 1（Birdseye 反映 4 ステップ）を実施して参照整合を確認。

## 4. Birdseye ホットエントリ更新手順
1. `docs/birdseye/index.json` の対象ノードを更新し、`generated_at` をホットリストと同一値へ揃える。
2. `docs/birdseye/caps/` 配下の該当 Capsule（例: `docs/birdseye/caps/docs.addenda.G_Security_Privacy.md.json`）を同期し、`maintenance.refresh` に今回の判断を反映。
3. `docs/birdseye/hot.json` で重点参照ポイントと理由を更新。安全審査で最優先に確認する経路を記述。
4. 更新結果を `workflow-cookbook/CHANGELOG.md` の「Safety」または「Security」に追記し、Birdseye 差分を監査ログへリンク。

## 5. 更新ログとトレーサビリティ
- 更新担当者は PR 本文に `workflow-cookbook/SAFETY.md` / `SECURITY.md` / `docs/addenda/G_Security_Privacy.md` の差分リンクを記載。
- `git blame` と Birdseye Capsule の `maintenance.refresh` を併用し、過去判断の出典と再現手順を追える状態を維持。
- 月次レビューでリンク切れとチェックリストの整合を確認し、差分は本ページと Birdseye index/caps/hot を同一 PR で更新する。
