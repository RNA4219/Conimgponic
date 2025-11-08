# 付録G: セキュリティ/プライバシー運用ガイド

> 対象: すべての運用担当者・エージェント実装者。`docs/security/SAC.md` の原則を実務へ反映するための手順と監視ルールを定義する。

## 1. キー管理

- **原則対応**: SAC-1, SAC-3, SAC-9。
- サーバサイドの Secrets 管理は `secrets.{env}.yaml` に一元化し、KMS からの起動時フェッチのみ許可する。
  ローカル `.env` はテスト専用で、本番接続情報を含めない。
- APIキー更新は 90 日サイクルを上限とし、失効ログを `audit/security-key-rotation.log` に記録する。
  更新後は旧キーを 1h 内に失効させる。
- モデル・LLM エンドポイント切替は IaC のマージでのみ許可。アプリ／クライアント設定画面からの切替は常に無効化する。

## 2. ログマスキングと監査

- **原則対応**: SAC-1, SAC-2, SAC-8。
- 監査ログは JSONLines 形式で `/var/log/workflow/audit.log` に集約し、PII/Secrets は `***` へ置換する。
  マスク対象: メールアドレス、アクセストークン、ユーザ識別子（UUID 含む）。
- LLM 応答は HTML エスケープ後に保存し、外部リンクは `rel="noopener"` を強制する。
  違反レスポンスは `security@workflow-cookbook.example` へ自動通知。
- ログ署名には HMAC-SHA256 を使用し、日次で鍵をローテーションする。
  署名検証は以下のコマンドで実行し、異常検知時は非ゼロ終了コードとともに原因を stderr に出力する。

  ```bash
  python tools/audit/verify_log_chain.py /var/log/workflow/audit.log \
    --secret "$AUDIT_HMAC_KEY" \
    --initial-signature "$(cat /var/log/workflow/audit.seed)"
  ```

  CI 週次ジョブへ組み込み、失敗時はリリースを停止する。

## 3. データ保持と削除

- **原則対応**: SAC-6, SAC-7, SAC-8。
- 監査ログの保持期間は 180 日。期日を超過したファイルは
  `python tools/audit/purge_logs.py /var/log/workflow/ --older-than 180`
  を用いて削除し、削除後は
  [セキュリティ監査ログ削除レポート](../reports/security-retention.md)
  に実行結果を記録する。
- 学習や検証のためのデータセットはバージョン固定し、`datasets/README.md` にハッシュを記録する。
  - テンプレート: `データセット名` / `バージョン / タグ` /
    `取得元 (URL / リポジトリ)` / `ハッシュ値 (SHA256)` の4列を必須とし、取得時点で空欄なく記入する。
  - `記録テンプレート` と `記入例` を同ファイルに保持し、追加登録時はテンプレート行をコピーして追記する。
    既知脆弱性が公開された依存バージョンは 24h 以内に差し替える。
- ユーザ削除リクエスト受領時は 72h 以内に対象データを特定し、削除証跡をチケットへ添付する。
  再生成が必要な場合は匿名化済みスナップショットのみ使用する。

## 4. 通信制御とツール実行

- **原則対応**: SAC-3, SAC-4, SAC-5, SAC-10。
- 外部通信は [`network/allowlist.yaml`](../../network/allowlist.yaml) に登録されたドメインへ限定し、
  `.github/workflows/reusable/security-ci.yml` の差分検証で逸脱を検知する。
  `Allowlist Guard` ジョブの `Validate network allowlist changes` ステップが
  `python -m tools.security.allowlist_guard --base-ref "$BASE_REF"` を実行し、
  Pull Request 時は `${{ github.base_ref }}` を基準に比較する。未承認のドメイン追加や目的変更が検出された場合、
  ワークフローが失敗してマージを停止する。ローカル検証は `python -m tools.security.allowlist_guard --base-ref origin/main`
  で実施する。
  ホワイトリスト外の通信要求は RUNBOOK の外部通信承認手順（[`RUNBOOK.md#outbound-request-approval`](../../RUNBOOK.md#outbound-request-approval)）に従い、
  申請テンプレート（[アウトバウンド通信申請テンプレート](../../tickets/outbound-request.md#申請テンプレート)）で申請項目を記入し、承認者・記録方法を満たした場合のみ許可される。
- ツール実行リクエストは JSON Schema [`schemas/tool-request.schema.json`](../../schemas/tool-request.schema.json) を通過し、
  `connect-src` は SAC 付録Aの CSP を最低限とする。
  Schema 違反時は失敗ログのみ記録し、リトライは3回まで。検証例:

  ```bash
  jq '.' tool-request.json | jsonschema -i - ../../schemas/tool-request.schema.json
  ```

- CSRF/CORS/CSP ヘッダは [`security_headers/middleware.py`](../../security_headers/middleware.py) を FastAPI/Starlette に適用して
  強制し、`pytest -m security_headers` の CI ジョブで逸脱を検出する。
  運用例:

  ```python
  from fastapi import FastAPI
  from security_headers import SecurityHeadersConfig, SecurityHeadersMiddleware

  app = FastAPI()
  app.add_middleware(
      SecurityHeadersMiddleware,
      config=SecurityHeadersConfig(
          strict_transport_security="max-age=63072000; includeSubDomains",
          content_security_policy="default-src 'self'",
      ),
  )
  ```

- リリース前は SAST・Secrets・依存・Container の 4 ゲートを [`.github/workflows/security.yml`](../../.github/workflows/security.yml) のワークフローで順次実行し、いずれか失敗時は本番リリースを禁止する。

## 5. 運用レビュー

- 月次レビューで本付録の遵守状況を確認し、逸脱がある場合は `TASK.codex.md` のテンプレートで是正タスクを登録する。
- SAC 改訂時は 7 日以内に本付録の該当節を更新し、改訂履歴を `CHANGELOG.md` に追記する。
