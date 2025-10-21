
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
    "precision": "legacy",
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

## アクティベーションマトリクス（AutoSave / Diff Merge）

| `autosave.enabled` \ `merge.precision` | `legacy` | `beta` | `stable` |
| --- | --- | --- | --- |
| `false` | AutoSave 初期化: **無効**<br/>Diff Merge タブ: **非表示**（従来 UI のみ） | AutoSave 初期化: **無効**<br/>Diff Merge タブ: QA/開発のみ手動起動（内部検証用） | AutoSave 初期化: **無効**<br/>Diff Merge タブ: **非表示**（安定版へは同時リリースしない） |
| `true` | AutoSave 初期化: **有効**（アイドル 2s→OPFS 保存）<br/>Diff Merge タブ: **非表示** | AutoSave 初期化: **有効**<br/>Diff Merge タブ: **表示**（β UI、既存セレクタと共存） | AutoSave 初期化: **有効**<br/>Diff Merge タブ: **表示**（stable UI、Diff マージ結果を既定） |

- `beta` 列は Phase B-0 に限定し、`import.meta.env.VITE_MERGE_PRECISION=beta` または `localStorage.merge.precision="beta"` で QA のみ解放。
- `stable` へ昇格する際は Phase B-1 で `autosave.enabled=true` が前提。未達成時は `legacy` へ即時ロールバック。

## フェーズ別既定値とチーム配布

| フェーズ | `autosave.enabled` | `merge.precision` | 配布対象 | 配布手順 |
| --- | --- | --- | --- | --- |
| A-0 | `false` | `legacy` | 全ユーザー | 既定値のまま (`pnpm run flags:reset`) |
| A-1 | `true` | `legacy` | QA/開発 | `.env.qa` に `VITE_AUTOSAVE_ENABLED=true`、`pnpm run flags:push --env qa` |
| A-2 | `true` | `legacy` | ベータ招待 | `flags:push --env beta` 実行後、QA レポートを共有 |
| B-0 | `true` | `beta` | ベータ招待 | `flags:set merge.precision beta` → `flags:push --env beta` |
| B-1 | `true` | `stable` | 全ユーザー | `flags:set merge.precision stable` → `flags:push --env prod` |

### チェックリスト
- [ ] 配布前に `pnpm run flags:status` でローカル値と既定値の差分を確認する。
- [ ] Canary 実施中は `reports/canary/` の JSONL を Analyzer に渡し、SLO が満たされていることを QA が確認済みである。
- [ ] ロールバック時は `pnpm run flags:rollback --phase <prev>` を利用し、対象チームへ Slack テンプレート `templates/alerts/rollback.md` を送付する。
