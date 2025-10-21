# Contracts (Cookbook ↔ External)

Cookbook は独立して動作します。外部拡張（例: 子リポジトリ）は、以下の契約を任意に満たすことで、機能を拡張できます。

## Artifacts

- `.ga/qa-metrics.json`: CI メトリクスの任意拡張。存在すれば Metrics Harvest が自動で取り込みます。

## Config

- `governance/predictor.yaml`: 予測ガバナンス用の重みや閾値。存在しない場合は既定値で実行されます。

```yaml
paths: {"src/providers/**": 5, "src/core_ext/**": 4, "docs/**": 1, "tests/**": 2}
size: {small: 0, medium: 2, large: 4, xlarge: 6}
retry_history_weight: 3
fail_history_weight: 5
threshold_warn: 7
threshold_block: 12
```

## Conventions

- すべて feature detection（存在検出）で扱われ、未提供でも Cookbook 側は正常に動作します。
