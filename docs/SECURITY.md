# SECURITY (PWA)
- CSP: `default-src 'self'; connect-src 'self' http://localhost:11434;`（index.html）
- 依存最小（React/Zustand）。CI では `osv-scanner`/`pnpm audit`/SBOM を追加推奨
- 生成ストリームに **timeout / maxChars** を導入（過大応答の抑制）
- Export は **OPFS snapshot** に保存し、失敗時は **最新成功物を復元**
- OPFS は origin-private。ブラウザのサイトデータクリアで消える点に留意
