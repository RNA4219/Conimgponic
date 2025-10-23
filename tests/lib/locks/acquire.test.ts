import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// AutoSave Locks の取得フローで発生する retryable 判定を RED で定義する。
// 実装が整い次第、`ProjectLockError` のコードと `retryable` 属性で検証する。

describe('acquireProjectLock retryable classification', () => {
  test('Web Lock timeout は fallback 試行が残る間 retryable=true', () => {
    assert.fail('RED: lock:error(operation=acquire, code=\'acquire-timeout\') should surface retryable=true until fallback engages');
  });

  test('navigator.locks 未対応でフォールバックへ移行した場合 retryable=true', () => {
    assert.fail('RED: fallback acquisition path must emit lock:fallback-engaged and keep retryable=true for acquire errors');
  });

  test('フォールバック衝突 (同一 leaseId 不一致) は retryable=false', () => {
    assert.fail('RED: lock:error(operation=acquire, code=\'fallback-conflict\') should mark retryable=false and trigger lock:readonly-entered');
  });

  test('AbortSignal 中断は retryable=false として即時伝播', () => {
    assert.fail('RED: aborted acquire must throw ProjectLockError with retryable=false and skip further backoff scheduling');
  });

  test('最大リトライ超過後の read-only 降格は retryable=false', () => {
    assert.fail('RED: lock:readonly-entered(reason=\'acquire-failed\') should reflect retryable=false after maxAttempts exhaustion');
  });
});
