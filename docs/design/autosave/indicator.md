# AutoSave Indicator テンプレート設計票

## 0. 概要
- **目的**: AutoSave Indicator の UI テンプレート資産を Phase A の要件に合わせて整備し、UI 実装とドキュメント間の粒度を統一する。
- **責務境界**: AutoSave ファサード (`initAutoSave`)、ロック API (`locks.ts`)、Collector 連携は外部契約とし、本票では HTML/CSS/TS テンプレートの定義に限定する。
- **参照仕様**: [AUTOSAVE-DESIGN-IMPL.md](../../AUTOSAVE-DESIGN-IMPL.md) §5 の UI 指針および状態/イベント整理に準拠する。

## 1. スコープ
### 1.1 対象
- `templates/ui/autosave/indicator.html` の DOM 構造・`data-*` 属性・`role`/`aria-*` の下準備。
- `templates/ui/autosave/_indicator.css` における `progress`・`warning`・`error` 系統のカラートークンとアニメーション変数の整理。
- `templates/ui/autosave/indicator.ts` の ViewModel インターフェースと `phase`・`retryCount`・`lastSuccessAt`・`isReadOnly` 等の束ね処理。
- テンプレートコメントによる Collector 通知禁止、および AutoSave ランナー側でのテレメトリ処理明記。

### 1.2 非対象
- React/TypeScript コンポーネント実装や Zustand/Redux 等の状態管理導入。
- Collector/Analyzer へのイベント通知・ログ整形ロジックの改修。
- `locks.ts` API 仕様や OPFS I/O の最適化・再設計。

## 2. テンプレート設計タスク
1. **UI スケルトン定義**: コンテナ/バナー/メタ情報/操作領域を持つ DOM を `indicator.html` に配置し、空ノードを禁止する。
2. **スタイル変数整理**: `_indicator.css` に状態別カラートークン・アニメーション用 CSS カスタムプロパティを定義し、既存トークン体系と重複しない命名とする。
3. **状態バインディング準備**: `indicator.ts` に `AutoSaveIndicatorViewModel` を宣言し、`phase`・`retryCount`・`lastSuccessAt`・`isReadOnly`・`historySummary` を公開する。
4. **アクセシビリティ下準備**: `role="status"`/`role="alert"`、`aria-live`/`aria-disabled`/`aria-busy` を data-attribute 経由でバインド可能にする。
5. **テレメトリ連携ポイント明記**: テンプレートコメントで Collector 通知を禁止し、必要なテレメトリは AutoSave ランナーで扱う旨を残す。
6. **ViewModel マッピング表作成**: `templates/ui/autosave/indicator.mapping.md` に ViewModel フィールドと DOM ノードの `data-bind-*` 対応表を記載する。
7. **テンプレート差分テスト方針記述**: `tests/templates/autosave/indicator.spec.ts` で `aria-*` 属性とラベル表示をスナップショット検証する方針をコメントとして残す。

## 3. 成果物テンプレート要件

| 成果物 | 要件 | 備考 |
| --- | --- | --- |
| `indicator.html` | `data-testid="autosave-indicator"`、`role="status"`/`role="alert"`、`aria-busy` 等の属性を data-binding で指定する。 | Collector 連携禁止コメントを明記し、空ノード禁止。 |
| `_indicator.css` | `progress`/`warning`/`error` のカラートークン・アニメーション変数を CSS カスタムプロパティで宣言。 | 既存トークン命名と衝突しないこと。 |
| `indicator.ts` | `AutoSaveIndicatorViewModel`（`phase`、`retryCount`、`lastSuccessAt`、`isReadOnly`、`historySummary`）を export する。 | TSDoc で Phase A 制約（`autosave.enabled` 二重ガード）を説明。 |

## 4. 検証観点
- テスト用 `data-testid` と `aria-*` 属性がテンプレート上で定義済みであること。
- `indicator.mapping.md` の ViewModel マッピング表とテンプレートの `data-bind-*` 属性が一致していること。
- `tests/templates/autosave/indicator.spec.ts` で ARIA ラベル・状態表示のスナップショットが更新されていること。

## 5. レビュー/チェックリスト
- [ ] HTML/CSS/TS の 3 ファイルが生成され、空プレースホルダーが存在しない。
- [ ] Collector 通禁止コメントが HTML/TS 双方に残り、責務分離が確認できる。
- [ ] ViewModel と DOM マッピング表がレビュー済みで、React 実装と整合している。
