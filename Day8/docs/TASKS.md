# Task Seeds 運用方針（Day8）

## 背景
- Task Seed は衝突や抜け漏れを防ぐための軽量ドキュメントであり、情報整理フローに合わせて「背景/手順/検証ログ/フォローアップ」の順で整備する。
- 運用は `workflow-cookbook/TASK.codex.md` のテンプレートと Day8 ガバナンスに従う。最新の整合性判断やレビュー履歴は [docs/UPSTREAM.md](UPSTREAM.md) および [docs/UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md) を参照する。
- Seed は `docs/seeds/` に配置し、タスクの合意形成と成果追跡のログとして扱う。

## 手順
1. **識別情報の設定**
   - `task_id` は日付ベース連番（例: `20250115-01`）。`work_branch` は作業ブランチ名、`priority` は `P1|P2|P3` を指定する。
   - メタデータ（`repo`, `base_branch`, `langs`, `status`, `last_reviewed_at`, `next_review_due` など）はテンプレート順に記入し、Katamari 運用で求められるレビュー期限を必ず設定する。
2. **本文セクションの記述**
   - Objective: タスク目的を一文で明示。
   - Scope: 対象領域と除外範囲を箇条書きで整理。
   - Requirements: 期待挙動、I/O 契約、制約、受入基準をテンプレート順に埋める。
   - Affected Paths / Local Commands: 変更予定パスを `glob` で列挙し、lint/type/test などのローカルコマンドを明記する。
   - Deliverables: PR で報告すべき Intent ID、Priority Score、リスク、フォローアップを整理する。
3. **Plan 以降のトラッキング**
   - Plan/ Patch/ Tests/ Commands/ Notes の各セクションで進捗ログを更新し、検証結果と残タスクを逐次反映する。
   - Guardrails に変更があった場合は [docs/UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md) を参照し、Seed の要件差分を追記する。
4. **保存と配置**
   - ファイル名は `TASK.<slug>-YYYY-MM-DD.md`。`<slug>` は英小文字ハイフン区切りで要約を表す。
   - Seed はドラフトからアクティブまでの状態を `status` で管理し、完了時は関連 PR/コミットリンクを追記する。

## 検証ログ
- Seed 作成・更新時は以下を確認し、検証結果を Notes/Tests セクションへ残す。
  - メタデータがテンプレート順で埋まっているか。
  - Scope と Requirements が最新のガバナンス（[docs/UPSTREAM.md](UPSTREAM.md)）と矛盾していないか。
  - Affected Paths と Local Commands が対象差分と一致しているか。
  - `status`・`next_review_due` が最新レビュー計画を反映しているか。

## フォローアップのチェックリスト
- [ ] `docs/seeds/` への配置と命名規約 (`TASK.<slug>-YYYY-MM-DD.md`) を満たした。
- [ ] Guardrails 変更時に [docs/UPSTREAM_WEEKLY_LOG.md](UPSTREAM_WEEKLY_LOG.md) を確認し、Seed へ必要な差分メモを追加した。
- [ ] Plan / Patch / Tests / Commands / Notes セクションで進捗と検証ログを更新した。
- [ ] 完了後に関連 PR・コミットリンクを追記し、後続作業の有無を明記した。
