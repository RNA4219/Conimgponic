
# リネーム移行ノート（非破壊）

## 目的
- プロジェクト名を「Imgponic」→「Conimgponic」に変更しつつ、**ユーザーのローカルデータ（OPFS/LocalStorage）を保持**する。

## 非破壊の基本原則
1. **OPFSのパス**は原則そのまま（例: `project/`, `runs/`）。
2. **LocalStorageキー**は旧キーを読み、**新キーへ複製**するフォールバック期間を設ける。
3. UI表示やドキュメント、パッケージ名は**即日置換**。

## 推奨バージョニング
- v1.4.1: ブランドリネームのみ（機能変更なし）。

## 具体的な互換対応（例）
- 設定 `ollamaBase` は旧キーのまま継続利用。将来 `conimg.ollamaBase` を追加し、起動時に旧→新へコピー。  
- PWA: `manifest.webmanifest` の `name/short_name` を変更。`scope`/`start_url` は変更不要。

## ロールバック
- 旧名参照箇所は**検索可能**に残す（コメント/CHANGELOG）。
