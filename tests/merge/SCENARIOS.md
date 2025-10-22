# Merge Engine テストシナリオ

- auto: `similarity>=profile.threshold` のハッピーパス。セクション分割結果が `MergeTrace` に `stage='segment'` で記録され、`autoDecisions` が増分されること。
- conflict: `similarity<profile.minAutoThreshold` のケース。`MergeDecisionEvent` が `retryable=false` で発火し、`trace.entries` に `stage='decide'` が記録されること。
- lock: `locks`/`sectionDescriptors.preferred` により `decision='conflict'` が強制され、`MergeStats.lockedDecisions` が加算されること。
- telemetry: `merge:finish` イベントで `stats` と `trace` が同時に送信され、UI が `MergeResult.trace` を参照してタイムライン描画できること。
- timeout: `ResolvedMergeProfile.maxProcessingMillis` を超過した場合に `MergeError('timeout')` が `retryable=false` でスローされ、テレメトリへ `merge:finish` が送信されないこと。
