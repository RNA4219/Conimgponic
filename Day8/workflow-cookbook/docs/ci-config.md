# CI 設定ガイド

## 自動キャンセル設定

すべての GitHub Actions ワークフローには、
同一ブランチ/PR 上で最新の実行だけを保持するための `concurrency` ブロックを追加しています。

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

- `group` はワークフロー名と PR 番号（またはブランチ名）の組み合わせで定義します。
  これにより PR と push のどちらでも古い実行をまとめてキャンセルできます。
- `cancel-in-progress: true` により、新しい Run が開始されたタイミングで進行中の古い Run を自動的に停止します。

CI の個別構成は `.github/workflows/` ディレクトリ内の各 YAML を参照してください。
