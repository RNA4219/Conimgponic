# CLI/Collector フラグ試験計画

## 1. スコープと目的
- 対象: AutoSave/精緻マージのフラグ状態によらず CLI エクスポートと Collector JSONL スキーマが後方互換を維持することの検証。
- 目的: Phase A/B で追加されるメタ情報が既存パイプライン（`downloadText`, `buildPackage`, `collector ingest`）を破壊しないことを確認。

## 2. テストケーステンプレート
| 項目 | 記入ルール |
| --- | --- |
| Test ID | `CC-{層}-{連番}` (`U`=ユニット, `I`=統合, `S`=スナップショット) |
| Flag Matrix | `autosave.enabled` / `merge.precision` の組み合わせ (`OFF+legacy`, `ON+beta`, `ON+stable`) |
| Preconditions | CLI 引数、エクスポート対象 storyboard、Collector の受信バッファ |
| Steps | CLI 実行 or Collector API 呼出の手順を列挙 |
| Expected Result | 出力ファイル構造、JSON スキーマ、ハッシュ値 |
| Snapshot | JSON/バイナリ差分の保存方式を明記 |

### ケース一覧
| Test ID | Flag Matrix | 概要 |
| --- | --- | --- |
| CC-U-01 | OFF + legacy | `downloadText` の JSON エクスポートが現行バージョンと完全一致 |
| CC-U-02 | ON + beta | AutoSave メタを含むが schema version は据え置きで差分が許容されるかを確認 |
| CC-U-03 | ON + stable | Merge スコア統計が付与されるが CLI 出力のルート構造が不変 |
| CC-I-01 | 各種 | `buildPackage` → Collector `ingestPackage` までの統合フローで JSONL スキーマ検証 |
| CC-S-01 | 各種 | Snapshot テストで CLI 出力ファイル一式を比較し、差分がスキップ対象かどうかをタグ付け |

## 3. I/O コントラクト
```typescript
export interface CliTestInput {
  flags: {
    autosaveEnabled: boolean;
    mergePrecision: 'legacy' | 'beta' | 'stable';
  };
  storyboard: MockStoryboard;
  exportArgs: {
    format: 'json' | 'zip';
    withHistory?: boolean;
  };
}

export interface CliTestExpectation {
  stdoutSnapshotKey: string;
  artifacts: Array<{
    path: string;
    hash: string; // sha256
  }>;
  collectorPayload?: CollectorEnvelope;
}

export interface CollectorEnvelope {
  schemaVersion: string;
  entries: CollectorEntry[];
}

export interface CollectorEntry {
  feature: 'autosave' | 'merge' | 'baseline';
  payload: Record<string, unknown>;
  retryable: boolean;
}
```
- `schemaVersion` は既存バージョン `1.7` を維持し、新規フィールドは `payload` 直下にネームスペース付きキー（例: `autosave.lock.leased`）。
- `hash` は CLI 出力のバイナリ互換性検証のため、Node の `crypto.createHash('sha256')` を利用。

## 4. スナップショット戦略
- CLI 標準出力は `stdoutSnapshotKey` を基に `__snapshots__/cli/{flag-matrix}.snap` へ保存し、差分が出た場合は原因をタグ付けする。
- エクスポート成果物は `artifacts` の `hash` を比較し、内容差分が許容されるケースでは `allowList` を別 YAML に管理。
- Collector JSONL は `CollectorEnvelope` を `JSON.stringify`(整形) し、スキーマ違反を JSON Schema バリデータで検出。

## 5. モックデータ設計
- `MockStoryboard` は AutoSave/Merge と共通定義を使用し、CLI では `withHistory` フラグで履歴を含むケースを追加。
- バイナリエクスポート（`format:'zip'`）の場合は固定シードで生成したランダムデータを埋め込み、スナップショットではハッシュ比較のみ行う。
- Collector テストでは AutoSave/Merge から送出されるテレメトリを 1:1 で再利用し、`retryable` の真偽でエラー分類を検証。

## 6. CI コマンド順序
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test --filter cli`
4. `pnpm test --filter collector`
5. `pnpm test -- --test-reporter junit --test-reporter-destination=file=reports/junit.xml`（CI レポート提出用）
