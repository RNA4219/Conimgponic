/**
 * Flags Handshake RED ケース一覧。
 * env 優先判定・設定変更通知・status.autosave 同期を Phase ガード配下で検証する。
 */
export type RedFocus =
  | "env-priority"
  | "config-notification"
  | "autosave-sync";

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
    id: "env-priority-overrides-storage",
    focus: "env-priority",
    description:
      "VITE_AUTOSAVE_ENABLED=true が conimg.autosave.enabled=false より優先され Phase guard を解除する",
    given: [
      "import.meta.env.VITE_AUTOSAVE_ENABLED='true'",
      "workspaceState.conimg.autosave.enabled=false",
      "FlagSnapshot.source='env'",
    ],
    when: "flags-handshake が snapshot.request をブリッジへ送出する",
    then: [
      "Bridge は snapshot.request を forward し autosave runner が起動する",
      "status.autosave は disabled→idle へ遷移し telemetry flag_resolution を Collector へ記録する",
    ],
  },
  {
    id: "config-notification-broadcast",
    focus: "config-notification",
    description:
      "conimg.autosave.enabled が VSCode 設定から更新された際に Webview へ変更通知をブロードキャストする",
    given: [
      "FlagSnapshot.source='config'",
      "workspaceState.conimg.autosave.enabled=true",
      "Phase guard は autosave.enabled を監視中",
    ],
    when: "settings.onDidChangeConfiguration で conimg.autosave.enabled が false に更新される",
    then: [
      "Bridge は flags:update イベントを Webview へ送信する",
      "Webview は Phase guard を disabled へ切り替え status.autosave.state を disabled へ同期する",
    ],
  },
  {
    id: "status-autosave-sync-roundtrip",
    focus: "autosave-sync",
    description:
      "snapshot.request → status.autosave → snapshot.result の往復で FlagSnapshot.source='localStorage' を維持する",
    given: [
      "FlagSnapshot.source='localStorage'",
      "autosave.enabled=true が localStorage から解決されている",
      "status.autosave.state='saving'",
    ],
    when: "flags-handshake が snapshot.request を送信し AutoSave runner から snapshot.result を受信する",
    then: [
      "status.autosave は saving→saved を経由し phase を維持する",
      "snapshot.result は source='localStorage' を保持し telemetry に retryable=false を記録しない",
    ],
  },
];
