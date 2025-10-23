/**
 * AutoSave ブリッジ RED ケース一覧。
 * 実装前に test runner へ組み込む想定で、最低限のシナリオ ID と前提を固定する。
 */
export type RedFocus = "env-priority" | "retry" | "readonly";

export interface RedCase {
  readonly id: string;
  readonly focus: RedFocus;
  readonly description: string;
  readonly given: string[];
  readonly when: string;
  readonly then: string[];
}

export const redCases: readonly RedCase[] = [
  {
    id: "env-priority-flag-snapshot",
    focus: "env-priority",
    description:
      "VITE_AUTOSAVE_ENABLED=true が localStorage=false より優先され、Phase guard が解除される",
    given: [
      "FlagSnapshot.source=env",
      "localStorage.autosave.enabled=false",
      "AutoSaveOptions.disabled!==true",
    ],
    when: "resolveFlags() から snapshot.request を許可する",
    then: [
      "Bridge は snapshot.request を forward する",
      "status.autosave は dirty→saving→saved へ推移する",
    ],
  },
  {
    id: "retry-lock-backoff",
    focus: "retry",
    description: "Web Lock 拒否後に指数バックオフで 3 回再試行し、fallback-engaged を送出する",
    given: [
      "FlagSnapshot.autosave.enabled=true",
      "navigator.locks.request が timeout を返す",
      "fallback .lock が利用可能",
    ],
    when: "AutoSave Runner が snapshot.request を送信する",
    then: [
      "lock:waiting を 3 回送出する",
      "lock:warning(fallback-engaged) を 1 回送出する",
      "4 回目の保存試行で snapshot.result.ok=true",
    ],
  },
  {
    id: "readonly-downgrade",
    focus: "readonly",
    description:
      "Web Lock と .lock の双方が失敗し retryable=false の lock:error で readonly 降格する",
    given: [
      "FlagSnapshot.autosave.enabled=true",
      "AutoSaveOptions.disabled!==true",
      "navigator.locks.request が NotSupportedError を返す",
      "fallback .lock 取得が mtime 衝突で拒否される",
    ],
    when: "AutoSave Runner が snapshot.request を送信する",
    then: [
      "lock:error(retryable=false) を受信する",
      "status.autosave.state は dirty のまま固定する",
      "UI は lock:readonly-entered を発火し CTA を無効化する",
    ],
  },
];
