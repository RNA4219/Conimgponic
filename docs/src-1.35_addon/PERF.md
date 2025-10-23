# PERF — パフォーマンス予算

## 予算
- 初回描画（100カード）: < 300ms (`performance.mark('initial-render')`)
- 操作応答: 主要操作 < 100ms（autosave、merge 操作、export ボタン）
- スクロール: 60FPS 近傍（仮想化）
- タイムライン計算: WebWorker へオフロードし UI スレッドブロック < 8ms
- メモリ: ブラウザ既定の 50% 未満を目安（計測ロガー付）
- Telemetry: JSONL flush は 15 分間隔で 2ms 未満 / イベント

## チェックリスト
- [ ] `status.autosave` メッセージ受信から UI 更新まで 100ms 未満
- [ ] `merge.trace` 処理で WebWorker へオフロードし main thread の `long task` を発生させない
- [ ] Export 処理中もスクロール FPS を `requestAnimationFrame` 計測で 55 以上維持
- [ ] Telemetry JSONL 書き込みが `pnpm test -- --runInBand tests/telemetry/vscode.contract.test.ts` で 15 分窓の性能を超過しない
- [ ] Phase ガード通知（PagerDuty/Slack）生成が Reporter ステップ内で 50ms 未満
