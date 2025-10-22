# AutoSave Indicator デザイン票（テンプレート）

## 0. 概要
- **目的**: AutoSave Indicator を段階導入するため、テンプレート資産と UI 成果物の粒度を統一する。
- **責務境界**: AutoSave ファサード (`initAutoSave`)、ロック API (`locks.ts`)、Collector 連携は外部契約とし、本票では UI テンプレートに限定する。
- **参照仕様**: [AUTOSAVE-DESIGN-IMPL.md](../../AUTOSAVE-DESIGN-IMPL.md) §5 の UI 指針と一致させる。

## 1. スコープ定義

### 1.1 対象
- `templates/ui/autosave/indicator.html` のマークアップ設計とデータ属性の割当。
- `templates/ui/autosave/_indicator.css` の状態別トークン整理（`progress`・`warning`・`error`）。
- `templates/ui/autosave/indicator.ts` の ViewModel インターフェース定義およびアクセシビリティ属性バインディング。
- テンプレートコメントで Collector 通知を禁止し、AutoSave ランナーでテレメトリ処理する旨を明文化。

### 1.2 非対象
- React/TypeScript 実装（`src/` 配下）のロジック移植や状態管理導入。
- Zustand/Redux 等ライブラリの採否判断および設定ファイル更新。
- Collector/Analyzer へのイベント通知・ログ整形の実装変更。
- ロック管理 (`locks.ts`) の API 仕様変更、OPFS I/O の最適化・再設計。

## 2. 成果物テンプレート

| 成果物 | 要件 | 備考 |
| --- | --- | --- |
| `indicator.html` | `data-testid="autosave-indicator"`、`role="status"`/`role="alert"`、`aria-busy` 等の属性を data-binding で指定。 | 空ノード禁止。コメントで Collector 連携禁止を明記。 |
| `_indicator.css` | `progress`/`warning`/`error` のカラートークン・アニメーション変数を CSS カスタムプロパティで宣言。 | 既存トークン体系と重複しない命名。 |
| `indicator.ts` | `AutoSaveIndicatorViewModel`（`phase`、`retryCount`、`lastSuccessAt`、`isReadOnly`、`historySummary`）を export。 | TSDoc で Phase A 制約 (`autosave.enabled` 二重ガード) を説明。 |

## 3. 検収チェックリスト
- [ ] HTML/CSS/TS の 3 ファイルが生成され、空プレースホルダーが存在しない。
- [ ] テスト用 `data-testid` と `aria-*` 属性がテンプレート上で定義済み。
- [ ] Collector 通知禁止コメントが HTML/TS 双方に残り、責務分離が確認できる。
