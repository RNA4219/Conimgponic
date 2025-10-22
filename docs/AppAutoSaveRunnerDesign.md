# App.tsx AutoSave ランナー導入設計

## 1. 目的と参照
- `App.tsx` で AutoSave の初期化・破棄を統括し、フィーチャーフラグに従って副作用を制御する。
- 保存ポリシー・API スペックは [docs/AUTOSAVE-DESIGN-IMPL.md](./AUTOSAVE-DESIGN-IMPL.md) を遵守する。
- Collector/Analyzer との干渉防止およびアーキテクチャ整合性は [Day8/docs/day8/design/03_architecture.md](../Day8/docs/day8/design/03_architecture.md) の責務境界に従う。

## 2. ライフサイクル要約
| タイミング | 条件 | App.tsx 側アクション | AutoSave ランナー状態 |
| --- | --- | --- | --- |
| マウント時 | `autosave.enabled` フラグが true かつ `initAutoSave` が未作成 | `initAutoSave` を呼び出し、`runnerRef` に保持 | `phase: idle` でスタート（保存ポリシーは既定値） |
| フラグ更新時 | 前回値と異なり true→false | `dispose()` を呼び副作用を停止、`phase: disabled` を通知 | 全デバウンス/ロックキューを破棄 |
| フラグ更新時 | false→true | `initAutoSave` を再実行し、新規 `snapshot` を購読 | 履歴整合性を確認後 `idle` |
| フラグ更新時 | true→true | no-op。既存ランナーを維持し、`snapshot` を更新 | 状態は継続 |
| アンマウント時 | ランナーが存在 | `dispose()` を呼び `runnerRef` を `null` | すべての副作用終了 |

### フェーズ配列との対応
- `docs/IMPLEMENTATION-PLAN.md` の Phase 行列に従い、`autosave.enabled` の既定値は Phase A-0 までは `false`、Phase A-1 以降にロールアウト対象へ段階的に `true` を配布する。【F:docs/IMPLEMENTATION-PLAN.md†L64-L93】
- App 側は `FlagSnapshot.source` から取得元（env/localStorage/既定値）を把握し、Phase A-1 までは QA セッションのみ `initAutoSave` を許可、β（Phase A-2）以降は対象ユーザーの `readOnly` 判定で除外する。
- Phase B 系では `merge.precision` の解放と並行しつつも AutoSave の挙動は同一コードパスを利用し、Phase が後退した場合は即座に `dispose()` を呼び `phase='disabled'` を維持する。

### フラグソース
- `FlagSnapshot`（例: `useFeatureFlags()` が返す）を `useEffect` で購読し、`autosave.enabled` の真偽により初期化・破棄を制御。
- フラグが undefined の間は初期化を保留し、`snapshot.phase = 'disabled'` を UI に渡す。

## 3. 副作用と隔離
- `useRef<AutoSaveInitResult | null>` を単一の副作用境界として扱い、副作用は `useEffect` のみで管理する。
- `initAutoSave` 呼び出しはフラグが true であるときのみ。結果の `dispose` は `useEffect` のクリーンアップおよびアンマウント時にのみ実行。
- `Collector`/`Analyzer` への不要イベント送出を避けるため、`initAutoSave` 前に `FlagSnapshot` が `readOnly`（Collector 動作中など）であれば `disabled` と同様の no-op 扱いとする。
- `snapshot()` は UI に閉じた状態共有とし、外部バス（Collector/Analyzer）へ通知しない。

## 4. React Effect 設計
```text
const runnerRef = useRef<AutoSaveInitResult | null>(null);
const [status, setStatus] = useState<AutoSaveStatusSnapshot>({ phase: 'disabled', retryCount: 0 });

useEffect(() => {
  if (!flags.ready) {
    // まだ FlagSnapshot が確定していないため待機
    return;
  }
  const enabled = flags.values['autosave.enabled'] === true;
  const readOnly = flags.context?.mode === 'read-only';
  const shouldRun = enabled && !readOnly;

  if (!shouldRun) {
    // 停止 or 未初期化
    if (runnerRef.current) {
      runnerRef.current.dispose();
      runnerRef.current = null;
    }
    setStatus((prev) => (prev.phase === 'disabled' ? prev : { phase: 'disabled', retryCount: 0 }));
    return;
  }

  // すでに初期化済みなら status を更新して終了
  if (runnerRef.current) {
    setStatus(runnerRef.current.snapshot());
    return;
  }

  // 初期化
  const runner = initAutoSave(getStoryboard, { disabled: false });
  runnerRef.current = runner;
  setStatus(runner.snapshot());

  const interval = window.setInterval(() => setStatus(runner.snapshot()), 1000);
  return () => {
    window.clearInterval(interval);
    runner.dispose();
    runnerRef.current = null;
  };
}, [flags.ready, flags.values['autosave.enabled'], flags.context?.mode, getStoryboard]);
```
- エフェクト依存配列では `FlagSnapshot` の relevant keys と `getStoryboard` の参照安定性を担保（`useCallback` を利用）。
- `setStatus` 更新は `snapshot()` に限定し、外部イベントを生成しない。
- Interval は UI 更新専用の副作用であり、Collector 系の計測には参加させない。

### AutoSaveIndicator との状態同期
- `initAutoSave` から得た `snapshot()` を 250ms ピリオドでストアへ反映し、`AutoSaveIndicator` へ `phase`/`retryCount`/`lastSuccessAt` を props 経由で渡す。高速すぎるポーリングは避け、Phase A-1 の監視要件（Retrying 3 回以上で警告）に合わせて更新する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L205-L238】【F:docs/IMPLEMENTATION-PLAN.md†L64-L93】
- `subscribeLockEvents` の購読解除は `dispose()` と同タイミングで実施し、`type='conflict'` 受信時は App ストアに `isReadOnly=true` を書き込み、Indicator が ReadOnly モードに遷移できるようにする。
- `flushNow()` / `restore` 操作は App 層で完結させ、結果イベントのみをストアへ格納する。Day8 アーキテクチャに沿って Collector へ直接通知せず、UI はステータス表示のみに専念する。【F:Day8/docs/day8/design/03_architecture.md†L1-L43】

## 5. 疑似コード（関数責務）
```ts
interface FlagSnapshot {
  ready: boolean;
  values: Record<string, unknown>;
  context?: { mode?: 'read-only' | 'active' };
}

type AutoSaveRunnerState = {
  ref: AutoSaveInitResult | null;
  status: AutoSaveStatusSnapshot;
};

function useAutoSaveRunner(flags: FlagSnapshot, getStoryboard: () => Storyboard): AutoSaveRunnerState {
  const runnerRef = useRef<AutoSaveInitResult | null>(null);
  const [status, setStatus] = useState<AutoSaveStatusSnapshot>({ phase: 'disabled', retryCount: 0 });

  useEffect(() => {
    if (!flags.ready) {
      return;
    }
    const readOnly = flags.context?.mode === 'read-only';
    const enabled = flags.values['autosave.enabled'] === true;
    const shouldRun = enabled && !readOnly;

    if (!shouldRun) {
      if (runnerRef.current) {
        runnerRef.current.dispose();
        runnerRef.current = null;
      }
      setStatus({ phase: 'disabled', retryCount: 0 });
      return;
    }

    if (!runnerRef.current) {
      runnerRef.current = initAutoSave(getStoryboard, { disabled: false });
    }

    const runner = runnerRef.current;
    setStatus(runner.snapshot());

    const timer = window.setInterval(() => setStatus(runner.snapshot()), 1000);
    return () => {
      window.clearInterval(timer);
      runner.dispose();
      runnerRef.current = null;
    };
  }, [flags.ready, flags.values['autosave.enabled'], flags.context?.mode, getStoryboard]);

  return { ref: runnerRef.current, status };
}
```

## 6. テスト計画
| ケース | 前提 | 操作 | 期待結果 |
| --- | --- | --- | --- |
| 初期化 no-op | `autosave.enabled=false` | App マウント | `initAutoSave` 非呼び出し、`status.phase='disabled'` |
| 初期化 success | `autosave.enabled=true` | App マウント | `initAutoSave` 呼び出し、`status.phase` が `'idle'` |
| フラグ無効化 | 初期化済み (`runnerRef` 保持) | フラグ true→false | `dispose` 実行、`runnerRef` が null、`status.phase='disabled'` |
| フラグ再有効化 | フラグ true→false→true | フラグ false→true | 新規 `initAutoSave` 呼び出し、`dispose` が旧ランナーに 1 回のみ実行 |
| ReadOnly 遷移 | `context.mode` を `read-only` に変更 | フラグ true 維持 | `dispose` 実行、`status.phase='disabled'` |
| アンマウント | フラグ true でマウント済み | `unmount()` 呼び出し | `dispose` 実行、タイマー解除 | 
| snapshot 更新 | 初期化済み | 時間経過 | `setInterval` により `status` が `snapshot()` の結果で更新 |

- すべてのテストで Collector/Analyzer へのイベント送出が行われないことをアサート（モック・スパイを利用）。
- React テストライブラリでマウント/アンマウント、フラグ変更をシミュレートし、副作用が所定回数で呼ばれたことを検証。

## 7. 実装ガイド
1. `useAutoSaveRunner` カスタムフックを作成し、`App.tsx` で利用する。
2. `FlagSnapshot` 取得ロジックに `read-only` 判定を追加し、`autosave.enabled` が true でも ReadOnly なら停止。
3. `App.tsx` は `status` を UI（AutoSaveIndicator 等）へ渡し、Collector/Analyzer と疎結合を維持する。
4. テストは TDD の順に「no-op 初期化」→「初期化 success」→「フラグ無効化」→「再有効化」→「ReadOnly」→「アンマウント」。
