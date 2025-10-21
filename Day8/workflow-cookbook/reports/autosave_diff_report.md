# AutoSave / Diff Merge 日次サマリ

- レポート対象日: {{ window }}
- サンプル数: {{ sample_size }} 件 {% if sample_size < 200 %}⚠️ 低サンプル{% endif %}

## 指標概要
| 指標 | 値 | 前日比 | SLO |
| --- | --- | --- | --- |
| 保存時間 P95 | {{ p95_save_duration_ms | round(0) }} ms | {% include "partials/delta_arrow.txt" with delta=deltas.p95_save_duration_ms unit="ms" %} | ≤ 2500 ms {% if p95_save_duration_ms > 2500 %}:warning:{% endif %}
| 復旧成功率 | {{ (recovery_success_rate * 100) | round(2) }} % | {% include "partials/delta_arrow.txt" with delta=(deltas.recovery_success_rate * 100) unit="%" %} | ≥ 98 % {% if recovery_success_rate < 0.98 %}:warning:{% endif %}
| 自動マージ率 | {{ (auto_merge_rate * 100) | round(2) }} % | {% include "partials/delta_arrow.txt" with delta=(deltas.auto_merge_rate * 100) unit="%" %} | ≥ 75 % {% if auto_merge_rate < 0.75 %}:warning:{% endif %}

## 詳細ノート
- 保存処理のロングテール要因: {{ long_tail_notes | default('N/A') }}
- 失敗イベント主要因: {{ failure_causes | default('N/A') }}
- コンフリクト傾向: {{ conflict_notes | default('N/A') }}

---
生成元: Day8 Reporter (`autosave-diff-merge` セクション)
