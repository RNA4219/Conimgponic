# ADR 0001: Collector/Analyzer/Reporter の 3 層パイプライン

- **ステータス**: Accepted
- **作成日**: 2025-10-31
- **レビュアー**: @day8-core, @ops-lead
- **関連チケット/タスク**: docs/TASKS.md#architecture, workflow-cookbook/CHECKLISTS.md#release

## 背景
- Katamari では CI ログ収集 → 解析 → レポート生成を分離した 3 層構成を採用し、責務ごとにフォールトアイソレーションを行っていた。
- Day8 でも workflow-cookbook で複数のスクリプトと GitHub Actions が協調するため、Collector が生成する JSONL ログの正規化と Analyzer の計算ロジック、Reporter の出力を混在させると保守コストが高まる。
- リポジトリ内では `docs/day8/design/03_architecture.md` が Collector → Analyzer → Reporter → Proposer → Governance の流れを提示しているが、決定根拠が散在しており Birdseye でのトレースが困難だった。

## 決定
1. **Collector**
   - CI や補助スクリプトからの JSONL ログを `workflow-cookbook/logs/` 配下へ集約し、スキーマは ADR 0002 で定義する契約に準拠する。
   - 取り込み時にエラーが発生した場合は再試行可能な一時失敗として扱い、Analyzer への入力を生成しない。
2. **Analyzer**
   - `workflow-cookbook/scripts/analyze.py` を単一エントリポイントとし、Collector から提供されたログを読み込み、メトリクスと Why-Why 草案を生成する。
   - 計算結果は中間成果物として `workflow-cookbook/reports/` へ書き出し、Reporter 以外の層から直接参照しない。
3. **Reporter**
   - Analyzer が吐き出したデータをもとに `reports/today.md` や `reports/issue_suggestions.md` を生成する。
   - Reporter は propose-only の制約を守り、自動コミットや push は行わない（詳細は ADR 0003）。
4. **観測性**
   - 3 層の境界は Birdseye (`docs/birdseye/index.json`) に Collector → Analyzer → Reporter → Proposer へのエッジとして登録し、`docs/day8/design/03_architecture.md` に図解する。

## 根拠
- Katamari での運用実績に基づき、Collector と Analyzer を分離することで障害箇所の特定が容易になる。
- Analyzer と Reporter を分けることで、メトリクス再計算とレポート再生成を独立して実行できる。
- propose-only 制約下で Reporter が勝手にリポジトリを書き換えないことを Birdseye から追跡できるようにする。

## 影響
- `docs/day8/design/03_architecture.md` は本 ADR を根拠とする説明を追加する。
- `workflow-cookbook/GUARDRAILS.md` は 3 層境界と propose-only 制約を参照する。
- Birdseye index/caps に新しいノード (`docs/adr/0001-...`) を追加し、`generated_at` を同期させる。

## フォローアップ
- [ ] Analyzer の計算ロジックを追加実装する際、メトリクスの中間成果物スキーマを ADR で追記する。
- [ ] Reporter が扱うレポート種別が増えた場合、本 ADR の影響範囲を再評価する。
