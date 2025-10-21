
# 機能フラグと既定値

```json
{
  "autosave": {
    "enabled": false,
    "debounceMs": 500,
    "idleMs": 2000,
    "maxGenerations": 20,
    "maxBytes": 52428800
  },
  "merge": {
    "precision": "beta",
    "profile": {
      "tokenizer": "char",
      "granularity": "section",
      "threshold": 0.75,
      "prefer": "none"
    }
  }
}
```
- フラグは `localStorage` または設定UI（将来）で切替
