# 生成 API 抽象契約（v1.3）

## 1) 呼び出し契約（抽象）
- Endpoint（抽象）: `POST /chat` （ストリーム返却）
- 入力:
```json
{
  "messages": [{"role":"user","content":"..."}],
  "options": {
    "seed": 123,
    "temperature": 0,
    "top_p": 1.0,
    "top_k": 0
  },
  "stream": true
}
```
- 出力（SSE/NDJSON等、チャンク単位）:
```json
{ "message": { "role": "assistant", "content": "..." }, "done": false }
```

## 2) 能力ネゴシエーション
- 起動時にトライアル要求を行い、`project/.capabilities.json` を生成:
```json
{
  "seed": true,
  "options": { "temperature": true, "top_p": true, "top_k": false }
}
```
- `seed:false` の場合は seed を無視し、evidence に `seed_applied:false` を記録。

## 3) タイムアウト/DoS ガード
- 既定: `timeoutMs=60000, maxChars=20000`。超過時は中断（UI通知）。

## 4) エラー契約
- 4xx: 入力不正（オプション範囲外など）
- 5xx: バックエンド障害（リトライガイドを提示）
- 断片チャンクはスキップ可。最終 `done:true` で完了。
