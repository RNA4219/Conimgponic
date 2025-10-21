
# Imgponic 追加仕様（フィクスチャ / CI / 語彙テンプレ）
発行日: 2025-10-21

本パッケージは **仕様書＆テンプレート（ドキュメントのみ）** です。実装コードは含みません。

- `FIXTURES-SPEC.md` … ゴールデン・テストフィクスチャ仕様
- `CI-SPEC.md` … 最小CIセットの仕様（Build, Audit, SBOM, License, Golden）
- `VOCAB-SPEC.md` … 語彙テンプレの仕様（映画用語・カメラ/レンズ・ネガティブ）
- `templates/` … 参考テンプレ（YAML, JSON, ディレクトリ構成の雛形）

> 目的：手戻りリスクを下げ、AutoSave/精緻マージ/Export-Importの回帰を短時間で検証できる状態を作る。
