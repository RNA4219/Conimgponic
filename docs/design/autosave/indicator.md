# AutoSave Indicator テンプレート設計タスク

## 目的
- AutoSave Indicator の UI/UX 実装に向け、テンプレート化した作業手順を定義し、フェーズ別に成果物の粒度を揃える。
- 依存モジュール（AutoSave ファサード、ロック API、Collector 連携）との責務境界を明示し、最小限の UI 変更で段階導入できるようにする。

## 対象タスク
1. **UI スケルトン定義**: `templates/ui/autosave/indicator.html` にコンテナ/バナー/メタ情報/操作領域の DOM 構造を作成する。
2. **スタイル変数整理**: `templates/ui/autosave/_indicator.css` に状態別のカラートークンとアニメーション用変数を配置し、`progress`/`warning`/`error` の 3 系統を定義する。
3. **状態バインディング準備**: `templates/ui/autosave/indicator.ts` に props 受け口を用意し、`phase`・`retryCount`・`lastSuccessAt`・`isReadOnly` を束ねる ViewModel インターフェースを宣言する。
4. **アクセシビリティ下準備**: テンプレート上に `role="status"`/`role="alert"` を設置し、`aria-live`/`aria-disabled`/`aria-busy` をバインディング用 data-attribute でマークする。
5. **テレメトリ連携ポイント定義**: テンプレートコメントとして Collector 通知を禁止し、必要なテレメトリは呼び出し元（AutoSave ランナー）で処理する旨を記述する。

## 非対象範囲
- React/TypeScript 実装（`src/` 配下）への直接的なロジック移植。
- Zustand/Redux など状態管理ライブラリの導入や選定。
- Collector/Analyzer へのイベント通知・ログ整形ロジックの追加。
- ロック管理 (`locks.ts`) の API 変更、またはファイルシステムアクセスの最適化。

## 成果物チェックリスト
- [ ] テンプレート/スタイル/スクリプトの 3 ファイルが生成され、空のプレースホルダーが存在しない。
- [ ] `data-testid` と `aria-*` 属性がテンプレート内でテスト駆動可能な状態で定義されている。
- [ ] Collector 通知禁止のコメントがテンプレートに残り、レビューで確認できる。
