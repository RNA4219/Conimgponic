# OPFS AutoSave 仕様（v1.3）

## 1) 保存ポリシー
- デバウンス 500ms、アイドル 2s で現在状態を `project/autosave/current.json` に保存。
- フォーカスロスト・タブ閉じ・PWA終了時は確定保存。

## 2) バージョン管理
- `project/autosave/history/<iso-ts>.json` に世代保存。
- `project/autosave/index.json` で N=20 世代を管理、超過時は FIFO で削除。
- 容量上限（既定 50MB）を超える場合は古い世代から削除。

## 3) 復旧フロー
- 起動時に `current.json` を検出 → 復旧確認ダイアログ。
- 復旧実行で現行SBに置換。置換前は `project/autosave/recovery/<iso-ts>.json` へ退避。

## 4) ロック戦略
- Web Locks API（`navigator.locks`）で `imgponic:project` を取得。
- 取得不可時は `project/.lock` を参照し、閲覧専用モードで開く。

## 5) UI
- ツールバー：AutoSave インジケータ（Saving / Saved HH:MM:SS）。
- 履歴ダイアログ：時刻・差分サイズを表示し、選択復元。

## 6) 受入基準
- 2.5s 以内に `current.json` 更新。
- 異常終了後、起動時復旧が成功。世代上限と容量上限が機能。
