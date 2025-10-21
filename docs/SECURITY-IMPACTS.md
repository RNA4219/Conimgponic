# セキュリティ／プライバシー影響（v1.3）

- CSP: 変更なし（`connect-src 'self' http://localhost:11434`）。
- Seed: 数値範囲の検証を追加（負値や極端値の拒否）。
- AutoSave: OPFS は origin-private。サイトデータ削除で消えるため、復旧ガイドを用意。
- ログ: `runs/` はローカルのみ保管。機微情報（固有名詞など）が含まれる可能性があるため閲覧権限は端末ユーザーのみに限定。
- DoS 抑制: 生成ストリームの timeout/maxChars は既定オン。
