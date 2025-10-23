import test from 'node:test';

// Day8 Collector/Analyzer/Reporter パイプラインと AUTOSAVE エラーポリシーを踏まえた RED ケース一覧。

test.todo('権限未宣言の hook 呼び出しは PluginPermissionError(retryable=false) で中断される (RED)');

test.todo('plugins.reload 失敗時に旧バンドルへロールバックし PluginReloadError(retryable=true) を Collector へ送る (RED)');

test.todo('log メッセージが extension:plugin-bridge タグ付きで Collector へ流れない場合に再試行する (RED)');
