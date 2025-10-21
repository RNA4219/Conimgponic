# CONFIG

## Ollama Base URL
- 既定: `http://localhost:11434`
- 変更方法:
  - 開発時: `.env` の `VITE_OLLAMA_BASE` を設定
  - 実行時: 画面上部の **Ollama Base** にURLを入力し `Save`

> CSPで `connect-src` を制限。`index.html` のポートも合わせてください。
