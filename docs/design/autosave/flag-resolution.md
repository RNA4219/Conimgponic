# Flag Resolution & Snapshot Contract

## 1. 目的
`docs/IMPLEMENTATION-PLAN.md` §0.1-0.2 で定義されたフラグポリシーを AutoSave ランナーへ安全に連携し、`docs/AUTOSAVE-DESIGN-IMPL.md` の保存ポリシーおよび Day8 Collector 系テレメトリ（`Day8/docs/day8/design/03_architecture.md`）と矛盾なく統合するための設計指針をまとめる。

## 2. `FlagSnapshot` 型定義
`src/config/flags.ts` の `FlagSnapshot` を下記の通り扱う。

```ts
interface FlagSnapshot {
  readonly autosave: AutosaveFlagSnapshot & {
    /** resolveFlag で正規化された boolean */
    readonly enabled: boolean
  }
  readonly merge: MergePrecisionFlagSnapshot & {
    /** resolveFlag で正規化された precision */
    readonly precision: MergePrecision
  }
  /** ResolveOptions.clock() から得た ISO8601 */
  readonly updatedAt: string
}
```

- `FlagValueSnapshot` 由来の `value` / `source` / `errors` を保持し、UI 層が `value` とドメイン特化エイリアス（`enabled` / `precision`）を同一視できることを保証する。【F:src/config/flags.ts†L37-L116】【F:src/config/flags.ts†L169-L231】
- `updatedAt` は `ResolveOptions.clock` を固定注入することでテストとテレメトリの再現性を確保する。

## 3. 優先順位と解決フロー
- **優先順位**: `import.meta.env` / `process.env` → `localStorage`（最新版 → `legacyStorageKeys`）→ `DEFAULT_FLAGS`。【F:docs/CONFIG_FLAGS.md†L57-L90】
- **互換フロー**: Phase-a0 では `App.tsx` が `resolveFlags()` を呼びつつ、既存の `localStorage` 直読フェールセーフを温存する。`FLAG_MIGRATION_PLAN` に従い段階的に直読を削除する。【F:docs/IMPLEMENTATION-PLAN.md†L20-L68】【F:src/config/flags.ts†L118-L231】
- **正規化**: boolean/precision の coercer は `invalid-*` エラーを `errors[]` に蓄積しつつ次順位へフォールバックする。Collector での監視値となるため、エラーを握り潰さずに通知する。

Mermaid シーケンス図（`docs/IMPLEMENTATION-PLAN.md` §0.2.1）を旗艦とし、既存の direct-read との整合を示す。

## 4. 後方互換ルール
1. **フェールセーフ維持**: Phase-a0 の間は UI 層（`App.tsx` / `MergeDock.tsx`）にて旧来の `localStorage` アクセスを残し、`FlagSnapshot.source` が `default` の場合でも初期表示を阻害しない。
2. **レガシーキー監視**: `legacyStorageKeys` (`flag:autoSave.enabled`, `flag:merge.precision`) は Phase-b0 で削除予定。Collector の JSONL へ `source='localStorage'` かつ `errors[].raw` にレガシー値が残っていることを記録し、削除前に空になることを確認する。
3. **API 安定性**: `src/config/index.ts` からの再エクスポートを維持し、Public API の変更なしに `resolveFlags` を追加利用できるようにする。破壊的変更が必要な場合は `FLAG_MIGRATION_PLAN` の新フェーズを追加し、CLI/JSON 出力互換性を明示する。
4. **保存ポリシー整合**: AutoSave ランナーは `autosave.enabled` が `false` の際に `docs/AUTOSAVE-DESIGN-IMPL.md` §1 の I/O を起動しない。`true` の場合のみロック取得→保存を実行し、`project/` 配下以外へ副作用を波及させない。

## 5. テレメトリ要件
- **イベント種別**: `flag_resolution` を Collector（Day8/Collector コンポーネント）へ送出し、`{ flag, value, source, errors, updatedAt }` を JSONL で記録する。
- **頻度**: App 起動時と AutoSave ランナー初期化時に 1 度ずつ。`FlagSnapshot.updatedAt` により重複排除が可能。
- **バリデーション**: `errors[]` が空でない場合は `severity=warn` とし、`retryable` に応じて Analyzer 側でバックオフ/調査優先度を切り替える。（`docs/AUTOSAVE-DESIGN-IMPL.md` §0.1, §1.2 のロールバック条件と同期。）
- **Collector 整合性**: Day8 アーキテクチャ文書で規定する Collector→Analyzer→Reporter の流れに合わせ、`reports/today.md` へ AutoSave rollout の健全性メトリクス（成功率 / 既定値フォールバック率）を追加する準備を行う。【F:Day8/docs/day8/design/03_architecture.md†L1-L52】

## 6. 実装ガイド
1. `resolveFlags()` の戻り値を UI へ渡す導線を整備（Phase-a0）。
2. `FlagSnapshot` を AutoSave ランナーへ注入し、保存ポリシーの有効化条件を一本化（Phase-a1）。
3. Merge Dock で `merge.precision` を gating に利用し、Diff Merge UI の公開を制御（Phase-b0）。
4. Collector へ `flag_resolution` イベントを追加し、Analyzer/Reporter の日次レポートに接続する。
