---
intent_id: INT-001
owner: config-working-group
status: active
last_reviewed_at: 2025-05-13
next_review_due: 2025-06-13
---

# Task Seed Template

## メタデータ

```yaml
task_id: 20250513-01
repo: https://github.com/Conimgponic/app
base_branch: main
work_branch: feat/config-flags-resolution
priority: P1
langs: [typescript]
```

## Objective

`src/config/flags.ts` の解決責務を formalize し、AutoSave/精緻マージ両機能の段階導入を env→localStorage→既定値の優先順位で統合する。

## Scope

- In: `src/config/flags.ts`, `docs/CONFIG_FLAGS.md`, `App.tsx`, `MergeDock.tsx`
- Out: AutoSave ランナー実装、Diff Merge UI 実装

## Requirements

- Behavior:
  - `resolveFlags()` が `FlagSnapshot` を返し、各フラグの `source` とバリデーション結果を同梱する。
  - 既存 UI の `localStorage` 直接参照を維持しつつ段階的移行を可能にする。
- I/O Contract:
  - Input: `ResolveOptions` (`env`, `storage`, `clock`)
  - Output: `FlagSnapshot` (`autosave.enabled`, `merge.precision`, `updatedAt`)
- Constraints:
  - 既存API破壊なし / 不要な依存追加なし
  - Lint/Type/Test はゼロエラー
- Acceptance Criteria:
  - FlagSnapshot が env/localStorage/既定値を正しく特定することを単体テストで証明する。
  - 後方互換の `localStorage` 値が不正な場合でも既定値へフェールオーバーし、`errors` が記録される。

## Affected Paths

- src/config/**
- docs/CONFIG_FLAGS.md
- src/App.tsx
- src/components/MergeDock.tsx
- tests/config/**

## Local Commands（存在するものだけ実行）

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Deliverables

- PR: タイトル/要約/影響/ロールバックに加え、本文へ `Intent: INT-001` と `## EVALUATION` アンカーを明記
- Artifacts: 変更パッチ、テスト、必要ならREADME/CHANGELOG差分

---

## Plan

### Steps

1) 現状把握（対象ファイル列挙、既存テストとI/O確認）
2) 小さな差分で仕様を満たす実装
3) sample::fail の再現手順/前提/境界値を洗い出し、必要な工程を増補
4) テスト追加/更新（先に/同時）
5) コマンド群でゲート通過
6) ドキュメント最小更新（必要なら）

## 設計詳細

### 型構成（`src/config/flags.ts`）

```mermaid
classDiagram
    class FlagSource {
        <<Union>>
        +env
        +localStorage
        +default
    }
    class FlagValidationIssue {
        +code: 'invalid-boolean' | 'invalid-precision'
        +flag: string
        +raw: string
        +message: string
        +retryable: false
    }
    class FlagValidationError {
        +source: FlagSource
    }
    FlagValidationError --|> FlagValidationIssue
    class FlagValueSnapshot~T~ {
        +value: T
        +source: FlagSource
        +errors: FlagValidationError[]
    }
    class AutosaveFlagSnapshot {
        +enabled: boolean
    }
    AutosaveFlagSnapshot --|> FlagValueSnapshot
    class MergePrecisionFlagSnapshot {
        +precision: 'legacy' | 'beta' | 'stable'
    }
    MergePrecisionFlagSnapshot --|> FlagValueSnapshot
    class FlagSnapshot {
        +autosave: AutosaveFlagSnapshot
        +merge: MergePrecisionFlagSnapshot
        +updatedAt: string
    }
    class FlagDefinition~T~ {
        +name: string
        +envKey: string
        +storageKey: string
        +legacyStorageKeys: string[]
        +defaultValue: T
        +coerce(raw): FlagCoerceResult
    }
    class ResolveOptions {
        +env?: Record<string, unknown>
        +storage?: Pick<Storage, 'getItem'> | null
        +clock?: () => Date
    }
```

| 型 | 役割 | 備考 |
| --- | --- | --- |
| `FlagDefinition<T>` | env/localStorage/既定値の優先解決を司るメタ情報 | `legacyStorageKeys` で Phase A の旧キー互換を維持 |
| `FlagCoercer<T>` | 文字列入力を強制型変換する純関数 | boolean/precision それぞれ個別実装 |
| `FlagValueSnapshot<T>` | 値・決定ソース・検証エラーをスナップショット化 | UI/Collector が `source` を参照し可観測性を確保 |
| `FlagSnapshot` | `resolveFlags()` が返す集約構造体 | `updatedAt` は `ResolveOptions.clock()` を ISO8601 で記録 |
| `FlagMigrationStep` | フェーズ別ロールアウト要件のメタデータ | `FLAG_MIGRATION_PLAN` により段階的ロールアウトを可視化 |

### 解決フロー（`docs/IMPLEMENTATION-PLAN.md` §0.2 同期）

```mermaid
flowchart TD
    Start([resolveFlags]) --> Env[env 正規化]
    Env -->|valid| SnapshotEnv[Snapshot ← env]
    Env -->|missing/invalid| Storage[localStorage 読み取り]
    Storage -->|valid| SnapshotStorage[Snapshot ← localStorage]
    Storage -->|missing/invalid| Legacy[legacyStorageKeys]
    Legacy -->|valid| SnapshotLegacy[Snapshot ← legacy keys]
    Legacy -->|missing/invalid| Defaults[DEFAULT_FLAGS]
    Defaults --> SnapshotDefault[Snapshot ← default]
    SnapshotEnv --> Final[FlagSnapshot + updatedAt]
    SnapshotStorage --> Final
    SnapshotLegacy --> Final
    SnapshotDefault --> Final
    Final --> Telemetry[FlagSnapshot.source を UI/Collector へ伝播]
```

### 後方互換マトリクス（`docs/IMPLEMENTATION-PLAN.md` §0.1-0.2 連携）

| 既存利用箇所 | 互換要件 | 対応策 |
| --- | --- | --- |
| `App.tsx` AutoSave 起動判定 | `localStorage.autosave.enabled` を直接参照する旧ロジックを Phase A で維持 | `FlagSnapshot.autosave.source==='localStorage'` の場合はイベントログへ `source` を残し、旧参照の削除は Phase B-0 以降に限定 |
| `MergeDock.tsx` タブ露出 | `localStorage.merge.precision` が `beta`/`stable` でない時の既定挙動を維持 | `merge.precision` が既定値へフォールバックした場合でも Diff タブが露出しないようガードを継続 |
| CLI (`scripts/config-dump.ts`) | `process.env` 参照互換 | `resolveFlags({ storage: null, env: process.env })` を提供してブラウザ依存を排除 |

## テスト駆動シナリオ（`tests/config/flags.spec.ts`）

1. env 優先: `import.meta.env` に `VITE_AUTOSAVE_ENABLED='true'`, `VITE_MERGE_PRECISION='beta'` を与え、`source==='env'`・正規化済み値を検証。
2. localStorage フォールバック: env 未設定、`localStorage.autosave.enabled='false'`, `localStorage.merge.precision='stable'` → `source==='localStorage'` を確認。
3. 既定値採用: env/localStorage/legacy が未設定 → 既定 JSON を採用し `source==='default'`、`updatedAt` が固定 `clock` 依存であることを確認。
4. 不正値処理: env が `"maybe"`/`"hyper"`、localStorage も不正 → `errors` に `invalid-boolean`/`invalid-precision` を追加し既定値へフェールオーバー。
5. 旧キー互換: 新キー未設定、`legacyStorageKeys` に値 → 旧キーから読み取り `source==='localStorage'`、`errors` は空。
6. FlagSnapshot.source 伝播: `resolveFlags()` の戻り値をモックコンシューマー（`App`/`MergeDock` のスタブ）へ注入し、`source` と `errors` がそのまま受け渡されることをアサート。
7. Clock 注入: `clock` を固定して `updatedAt` が期待する ISO8601 文字列になること、`Date` 呼び出しが 1 回に限定されることを確認。
8. テレメトリ積み上げ: `errors` を含むスナップショットを Collector モックへ送出し、`source` と `errors.code` を JSONL 化できることを検証。

## レビュー用チェックリスト

- [ ] 入力ソースマッピング: env→localStorage→legacyKey→既定値の優先順位が `docs/CONFIG_FLAGS.md` と一致しているか。
- [ ] 回帰リスク評価: Phase A の旧 `localStorage` 直接参照が継続し、Diff タブ露出条件が変化していないか。
- [ ] ロールバック手順: `pnpm run flags:rollback --phase <prev>` 実行時に `FlagSnapshot.source` が `default` へ戻ること、Collector がロールバック記録を保持するか。
- [ ] テレメトリ: `FlagValidationError` を JSONL に出力できること、`retryable=false` を維持できているか。

### 承認フロー

1. Config WG（Owner）: 設計整合性レビュー
2. QA リード: TDD シナリオと回帰リスク評価
3. リリースマネージャー: ロールバック手順確認後に承認

