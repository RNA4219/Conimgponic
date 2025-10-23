import { describe, test } from 'node:test';

// RED フェーズ: 未実装シナリオを列挙するためのスケルトン。
describe('plugin bridge failure handling (RED)', () => {
  test.todo('権限追加が未承認のまま reload を試行した場合に E_PLUGIN_PERMISSION_PENDING を返す');
  test.todo('権限拒否で E_PLUGIN_PERMISSION_DENIED を返し旧版へロールバックする');
  test.todo('依存解決失敗で E_PLUGIN_DEP_RESOLVE を返し再試行をスケジュールする');
  test.todo('reload シーケンスで Webview ack を受け取らずタイムアウトした際に E_PLUGIN_RELOAD_FAILED を返す');
  test.todo('log(level=error, retryable=false) を受信した際に Collector へ転送し UI 通知する');
});
