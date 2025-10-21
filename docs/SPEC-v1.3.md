# Imgponic Reboot v1.3 仕様（要件定義）
発行日: 2025-10-21

## 0. 目的と前提
- v1.2（PWA）の上に、次の3点を追加：
  1) **seed 配線**：生成の決定性／再現性の向上  
  2) **OPFS 自動バックグラウンド保存**：編集中データの保全  
  3) **差分マージの精緻化**：3-way merge・信頼度・衝突解決
- 外部通信は従来通り **`http://localhost:11434` のみ**（CSPで強制）。

## 1. 機能要件（概要）
### 1.1 生成 `seed` 配線
- `Scene.seed:number` を API オプションへ伝播し、モデル対応時は決定的出力を狙う。
- モデル非対応時は処理継続。ただし `seed_applied:false` を evidence に記録。
- 追加の決定性プロファイル（例）: `Deterministic`（temperature=0, top_p=1.0 など）を既定とする。

### 1.2 OPFS 自動バックグラウンド保存（AutoSave）
- 入力デバウンス 500ms + アイドル 2s で `project/autosave/current.json` を保存。
- N世代（既定 20）ローテーションを `project/autosave/history/` に保持。
- 起動時に復旧確認ダイアログ。復旧前の状態は `recovery/` へ退避。

### 1.3 差分マージの精緻化
- 単位：**シーン** → **セクション**（ラベル）→ 行ブロック。
- アルゴリズム：**3-way merge**（Base=採用テキストの前版, Ours=Manual, Theirs=AI）。
- 類似度（既定しきい値 0.75）で自動マージ/衝突判定。ロック（manual/ai）を尊重。

## 2. 非機能要件
- 決定性：同一 seed/設定で同一出力（モデル実装依存は evidence に記録）。
- 性能：AutoSave 2.5s 以内、マージ 100カット/5秒以内（参考値）。
- 可観測性：`runs/<ts>/` に seed適用やマージ統計を保存。

## 3. UI 変更（要点）
- ツールバー：AutoSave インジケータ（Saving/Saved HH:MM:SS）。
- 統合ペイン：差分プレビュー、信頼度メーター、衝突解消ボタン（Manual/AI/手動）。
- Checks セクション：Seed適用状態の表示（✓/⚠）。

## 4. データモデル差分
- `project/.capabilities.json`（新規）：`{ "seed": true|false, "options": {...} }`
- `runs/<ts>/merge.json`（新規）：マージ決定・類似度・衝突数を記録。
- 既存 `storyboard.json` は**前方互換**（追記のみ）。

## 5. 受入基準（抜粋）
- seed適用：同一条件でテキスト一致率 ≥ 99%（空白差は除外）。
- AutoSave：停止 2.5s 以内に保存／クラッシュ復旧成功。
- マージ：ラベル付きで自動マージ率 ≥ 80%、衝突はUIで全解消可能。

## 6. リスクと対策
- モデル非決定性：`seed_applied`/`model`/`version` を evidence に保持。
- 容量：AutoSave の世代ローテーション＋容量しきい値（既定 50MB）。
- 多タブ：Web Locks API 優先、非対応時は advisory lock。

## 7. スケジュール（目安）
- 仕様凍結→設計レビュー→PoC→E2E→リリース候補（合計 約 1〜1.5 週・1人）。
