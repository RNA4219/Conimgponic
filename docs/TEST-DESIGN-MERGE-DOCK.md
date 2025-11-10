# MergeDock テスト設計 (Test Design)

対象ファイル: src/components/MergeDock.tsx
参照: docs/MERGE-DESIGN-IMPL.md, MergeDock.tsx

目的
- MergeDock の機能仕様に沿ったテストを、テスト駆動開発を前提に設計・実装する。
- 公開APIの互換性を崩さない前提で、ユニットテスト中心に拡張する。

テスト方針
- ユニットテスト: MergeDock の内部状態とUI操作の最小単位を検証する。
- 統合テスト: AutoSave のハートビートと precision 切替処理の連携を検証する。
- テスト実行はプロジェクト標準のコマンドを適用。lint/type/test の結果をグリーンにすることを最優先とする。

テスト範囲
- レンダリング: コンポーネントのレンダリングが崩れず、基本的な要素をレンダリングする。
- タブ切替: Diff / Merge などのタブ切替 UI が正しく機能する。
- Precision 切替: 精度モードの切替が内部状態と UI に反映される。
- AutoSave ハートビート: 一定間隔で AutoSave のトリガーが走る挙動をモックで検証する。
- Diff/Merge の連携フロー: ユーザー操作に応じて UI 部分が適切に変化することを検証する。

成果物
- MergeDock.test.tsx のユニットテスト雛形
- Mock/Stub のスニペット

実行手順
- npm run test または yarn test を実行し、テストを実行する。
- テスト失敗時はエラーログを元に修正を繰り返す。

補足
- 具体的な DOM 要素名は MergeDock.tsx の実装を参照して追従する。本文は仮想のテスト設計となるため、実装に合わせて微調整すること。