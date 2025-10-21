
# AutoSave 実装詳細

## 1) 保存ポリシー
- デバウンス 500ms + アイドル 2s で `project/autosave/current.json` を保存
- `history/<ISO>.json` を最大 N=20 世代。`index.json` で参照
- 容量上限 50MB 超過時は古い順に削除（FIFO）

## 2) API
```ts
type AutoSaveOptions = { debounceMs?: number; idleMs?: number; maxGenerations?: number; maxBytes?: number }

export function initAutoSave(getSB: ()=>Storyboard, opts?: AutoSaveOptions): () => void
export async function restorePrompt(): Promise<null | { ts: string, bytes: number }>
export async function restoreFromCurrent(): Promise<boolean>
export async function listHistory(): Promise<{ ts: string, bytes: number }[]>
export async function restoreFrom(ts: string): Promise<boolean>
```

## 3) ロック
- `navigator.locks.request('imgponic:project', { mode:'exclusive' })`
- 失敗時：閲覧専用モード（保存UI無効化）
- フォールバック：`project/.lock`（UUID, mtime, TTL=30s）

## 4) 書き込みの原子性
- `current.json.tmp` → 書込完了 → リネームで原子更新
- `index.json` 更新も同様（tmp→rename）

## 5) UI
- ツールバー右に **AutoSaveIndicator**（Saving…/Saved HH:MM:SS）
- 履歴ダイアログ：時刻・サイズ・復元ボタン・差分サイズ（現行比）

## 6) 異常系
- 書込失敗：指数バックオフ（0.5/1/2s）で3回再試行。失敗時は警告を残し続行
- 容量枯渇：古い履歴を自動削除＋通知

## 7) 受入
- 入力停止 ≤2.5s で `current.json` 更新
- 強制終了後の復旧が成功、かつ 21回保存で最古が削除
