# VERSIONING — バージョニング／移行

- `meta.apiVersion`（semver）。破壊的変更時はメジャー更新。
- 旧版→新版の**マイグレーター**は別モジュール化。実行は明示操作のみ。
- `runs/<ts>/meta.json` に生成器バージョンを刻む。
