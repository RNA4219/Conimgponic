# docs: import v1.0 Conimgponic docs bundle

Intent: INT-2025-DOCS-V1
Priority Score: 6.5 / 初期ドキュメントとテンプレ群の導入で以後の実装・検証を高速化

## 概要
- v1.0 ドキュメントバンドルの取り込み（仕様書・テンプレート類）
- ゴールデン・フィクスチャ/最小CIセット/語彙テンプレ等
- 実装コードへの破壊的変更なし

## 変更点（要旨）
- docs/, templates/, reports/schemas などの追加/整理
- README/索引の更新（ある場合）

## テスト / 検証
- (ローカル) lint/build: 影響なし or OK
- (CI) SBOM / License / Golden 等の既存WFが通過

## 互換性・リスク
- 後方互換（ドキュメント中心） / リスク低
- ロールバック: このPRをrevertで可

## EVALUATION
- [ ] CI 全緑（Build/Audit/SBOM/License/Golden）
- [ ] 追加ドキュメントのリンク切れなし
- [ ] 破壊的変更なし（ランタイム/公開API）
