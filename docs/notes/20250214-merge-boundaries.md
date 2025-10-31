# Merge モジュール分割メモ (2025-02-14)

## 目的
- `src/lib/merge.ts` の 1,000 行超を段階的に分割する初手として、プロファイル解決とセクション分割を独立モジュール化。
- `resolveThreshold` / `splitSections` を node:test で固定化し、以後の差分検証を局所化する。

## 境界
- `src/lib/merge/profile.ts`
  - Precision 定義 (`PRECISION_THRESHOLD_CLAMP`, `PRECISION_CONFIG`) と閾値解決 (`resolvePrecision`, `resolveThreshold`) を保持。
  - 外部 I/O は環境変数のみ。`DEFAULT_THRESHOLD` を公開し `DEFAULT_MERGE_PROFILE` が共有する基準値を一元化。
- `src/lib/merge/sections.ts`
  - テキストのブロック分割 (`tokenSections`, `splitSections`) とトークン化 (`tokenize`)・類似度計算 (`computeJaccard`, `computeCosine`) を担当。
  - `MergeSection` を公開し、`merge.ts` 本体は意思決定とトレース生成に集中。

## テスト
- `tests/lib/merge/mergeCore.spec.ts`
  - Precision clamp とロック優先順位を確認。
  - セクション分割が `sections`, `sectionDescriptors`, `locks`, `profile.prefer` を deterministic に統合することを検証。
  - ガードレール自己検証: `pnpm test --filter lib -- --test-name-pattern merge`（`tests/lib/opfs.load-errors.test.ts` の既知重複定義エラーで終了コード非ゼロ）。

## フォローアップ候補
- スコアリング (`blendedScore` など) を別モジュールへ抽出し、`MergeScoringStrategy` のテストを追加。
- `profile.ts` の環境依存 (`process.env`) をインターフェース化し、DI 経由で制御可能にする。
