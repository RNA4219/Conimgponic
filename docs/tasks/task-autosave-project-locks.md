# Task: AutoSave プロジェクトロック TDD & ロールバック

## 背景
- AutoSave ランナーが `src/lib/locks.ts` 経由で Web Lock / フォールバック `.lock` を制御するにあたり、再試行・TTL 更新・readonly 降格のテスト駆動が必要。
- Implementation Plan §1 と `docs/design/autosave/project-locks.md` のイベントマトリクスをチケットへ落とし込み、Day8 運用と矛盾しないガードを整備する。

## ゴール
1. `tests/autosave/locks.spec.ts` に再試行、TTL 更新、readonly 降格シナリオを網羅する。
2. 失敗時ロールバック手順を Runbook と突き合わせ、`autosave.lock.readonly` テレメトリを利用した判断フローを確立する。

## 想定 TDD ケース
| Case ID | 観点 | 手順 | 期待イベント/結果 |
| --- | --- | --- | --- |
| LOCK-RETRY-01 | Acquire 再試行 | Web Lock 失敗を 2 回シミュレート → 3 回目で成功。 | `lock:attempt` → `lock:waiting(delay=500)` → `lock:waiting(delay=1000)` → `lock:acquired`。再試行上限到達時は `lock:readonly-entered(reason='acquire-timeout')`。 |
| LOCK-TTL-02 | Heartbeat TTL 更新 | `.lock` 戦略で `renewProjectLock` を 2 回成功させ `expiresAt` 延長を検証。 | `lock:renew-scheduled` の `nextHeartbeat` が `ttl-5000`、更新後 `expiresAt` が `now + 30000ms` に更新。遅延時は `lock:warning('heartbeat-delayed')`。 |
| LOCK-READONLY-03 | Readonly 降格 | Acquire 失敗上限・Renew 失敗・Release 失敗を個別に再現。 | それぞれ `lock:readonly-entered` が `reason='acquire-timeout' / 'renew-failed' / 'release-failed'` を返す。`onReadonly` コールバックが 1 度のみ起動。 |
| LOCK-WITH-04 | withProjectLock 心拍 | 長時間タスクをモックし `renewIntervalMs` 既定値で自動更新。 | Acquire→Renew→Release が順序通り呼ばれ、例外時に `releaseOnError` が true のまま解放される。 |

## ロールバック手順
1. `autosave.lock.readonly` の 5 分移動平均が 5% を超過したら、`autosave.enabled=false` を Flags Config に設定して Phase A-1 へ戻す。【F:docs/CONFIG_FLAGS.md†L57-L90】
2. `.lock` 残留が `project/` 配下で連続 3 回観測された場合、Day8 Runbook 手順 4 に従いフォールバック無効化 → Web Lock のみで再試行。【F:docs/design/autosave/project-locks.md†L113-L127】
3. Collector が `.lock` を誤収集した場合はパイプラインを停止し、`workflow-cookbook/` リストから除外設定を見直す。復旧後に `autosave.lock.readonly` の異常値が 30 分以内に収束しない場合はリリースをロールバック。

## 依存
- Implementation Plan §1.1〜§1.4 のイベントマトリクス。
- Day8 Architecture 運用ガード（Collector/Analyzer/Reporter）。

## 完了条件チェックリスト
- [ ] 上記 TDD ケースが `tests/autosave/locks.spec.ts` へ追加され、失敗→成功の赤緑確認を完了した。
- [ ] `autosave.lock.readonly` メトリクスを PagerDuty/Slack へルーティングする設定を QA で検証した。
- [ ] `.lock` フォールバック停止 Runbook とロールバック条件が同期され、レビュー承認を得た。
