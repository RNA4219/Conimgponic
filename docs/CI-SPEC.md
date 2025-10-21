
# 最小CIセット仕様（GitHub Actions想定）

## 1. 目的
- 毎PRで**ビルド可能性**と**既知脆弱性**、**ライセンス/依存**、**ゴールデン一致**を確認。
- 失敗時は**原因が一目で分かるログ**を出す。

## 2. 必須ジョブ
1. **build**: `pnpm i && pnpm -s build`（型チェック込み）
2. **audit**: `pnpm audit --audit-level=moderate` + `osv-scanner`（推奨）
3. **sbom**: Syft or CycloneDX で SBOM 生成（`sbom.json` をアーティファクト化）
4. **license**: ライセンス収集（allowlist: MIT/BSD/Apache-2.0 など）
5. **golden**: コンパイル→フィクスチャと比較（正規化ルールを適用）

## 3. 成否判定
- **build**: Vite/TS が通る
- **audit**: High/critical が検出されたら失敗（例外は `ALLOWLIST` にピン留め）
- **sbom/license**: 生成成功、禁止ライセンスが無い
- **golden**: 1ケースでも不一致→失敗

## 4. 成果物
- `artifact: sbom.json, audit-report.json, golden-diff.txt`

## 5. 実行タイミング
- `pull_request` と `push`（main）
- 1日1回の `schedule`（脆弱性/ライブラリアップデートの監視）

## 6. 秘匿情報
- CI内でネットワーク先は**自前依存のみ**（npm registry）
- GitHub Token 以外のシークレットを**不要化**（PWAはローカル通信のみ）
