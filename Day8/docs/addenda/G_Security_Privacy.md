# Appendix G: セキュリティ & プライバシー（Day8 移植版）

Katamari Appendix G を Day8 の現行運用とツール構成へ合わせて再編したリファレンス。`workflow-cookbook/SECURITY.md` と `docs/day8/security/05_security.md` を補完し、キーや認証情報の扱いから監査ログ・データ保持・通信保護の実装ノートを 1 箇所で確認できるようにする。

## 0. ハブ & 参照順
- **一次ハブ**: [workflow-cookbook/SECURITY.md](../workflow-cookbook/SECURITY.md)（承認プロセス・例外記録）、[workflow-cookbook/SAFETY.md](../workflow-cookbook/SAFETY.md)（倫理/安全配慮）。
- **Day8 連携**: [docs/day8/security/05_security.md](../day8/security/05_security.md)（実装チェックリスト）、[docs/safety.md](../safety.md)（フェイルセーフ・例外運用）、[docs/ROADMAP_AND_SPECS.md](../ROADMAP_AND_SPECS.md)（Birdseye 反映動線）。
- **更新順序**: `workflow-cookbook/SECURITY.md` → 本付録 → `docs/day8/security/05_security.md` → `docs/birdseye/index.json` / `caps/` / `hot.json`。

## 1. キー管理
- **保管ポリシー**: Git トラッキング禁止。`secrets/` テンプレートはプレースホルダのみ残し、実値は Day8 Vault（環境変数注入）で管理。
- **ローテーション**: 90 日サイクル。更新時は `workflow-cookbook/SECURITY.md` の「キー更新ワークフロー」を起票し、Birdseye Hot リストへ暫定エントリを追加して監視する。
- **共有手順**: 権限所有者のみ。共有チャネルは Guardrails 承認済み（Katamari KeySafe）に限定し、転送ログを `workflow-cookbook/logs/` に保管。
- **デリバリ**: CI/CD へ渡す際は GitHub Encrypted Secrets と OIDC フェデレーションを優先し、自己ホスト Runner は禁止。

## 2. ログ衛生
- **収集**: 監査対象アクション（Birdseye 更新、Guardrails 例外、CI ゲート失敗）は `workflow-cookbook/logs/` で JSON Lines 形式へ統一。
- **マスキング**: PII / API キーは `***` で置換。`docs/day8/security/05_security.md` のチェックリスト「ログ衛生」を通過しないログは保管禁止。
- **アクセス**: レビュー時は読み取り専用で開き、編集が必要な場合は新規ファイルへ差分を作成。ログ編集履歴は Birdseye Capsule へ追記。
- **保守**: 30 日でアーカイブ。`workflow-cookbook/tools/logrotate.py`（準備中）の導入までは手動で `logs/archive/` へ移動し README に記録。

## 3. データ保持
- **分類**: 運用ログ（30 日）、設計ドキュメント（常時）、Secrets メタデータ（90 日）で保持期間を定義し、例外時は `workflow-cookbook/SECURITY.md` の承認記録を添付。
- **削除フロー**: 期限到来時に `workflow-cookbook/CHECKLISTS.md` の「Retention Gate」を実行し、Birdseye index から該当ノードを除外 or 更新。
- **証跡**: 削除結果は `workflow-cookbook/reports/` にまとめ、`docs/safety.md` のフェイルセーフ履歴テーブルへ転記。
- **バックアップ**: センシティブデータのバックアップは禁止。再生成可能なメタ情報のみ README 等で復元手順を記す。

## 4. 通信保護
- **チャネル**: HTTP(S) API の呼び出しは TLS1.2+ を必須とし、Webhook などの受信エンドポイントは全て `allowlist` ベースで制限。
- **内部連携**: Day8 ↔ workflow-cookbook 間の同期は GitHub Pull Request 経由に限定し、直接 SCP/rsync は禁止。
- **モニタリング**: 異常なリクエストは `workflow-cookbook/logs/` へ記録し、Birdseye Hot リストへ一時タグを追加。`docs/birdseye/hot.json` を更新する際は `generated_at` を本付録と揃える。
- **サードパーティ**: 外部 SaaS 利用時は OAuth scope を最小化し、データ転送契約（DPA）を `workflow-cookbook/SECURITY.md` にリンク。

## 5. 認証 / OAuth ガード
- **権限モデル**: 役割ベース（Maintainer / Reviewer / Bot）。Bot は `allow_actions` に制限し、PR マージ権限を持たせない。
- **OAuth 登録**: 新規アプリ登録は `workflow-cookbook/SECURITY.md` のテンプレートへ記録し、クライアントシークレットは Vault へ格納。
- **リダイレクト URI**: HTTPS のみ許可。ローカルデバッグは `localhost` 限定、公開 callback を使い回さない。
- **トークン寿命**: アクセストークンは 1 時間、リフレッシュトークンは 30 日。失効時は Birdseye へ記録し、手動で Revocation を実行。
- **異常検知**: OAuth 例外は即座に `docs/safety.md` の例外手続きへエスカレーション。

## 6. メンテナンスと差分反映
- 更新が発生したら `git grep` で該当する「キー」「ログ」「Retention」「OAuth」を検索し、差分を `docs/day8/security/05_security.md` と `workflow-cookbook/SECURITY.md` へ同期。
- Birdseye 連携（index → caps → hot）の更新を実施し、`generated_at` を同一値へ揃える。
- 更新履歴は `workflow-cookbook/CHANGELOG.md` の「Security」セクションへ追記し、RCA や例外記録と紐付ける。
