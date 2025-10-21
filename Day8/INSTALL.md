# workflow-cookbook Addons (Eight-Day Starter)

このフォルダ内のファイルを **リポジトリのルート** に配置してください。
最低限必要なのは次の通り：

- `governance/policy.yaml`
- `workflow-cookbook/governance/policy.yaml`
- `workflow-cookbook/reflection.yaml`
- `workflow-cookbook/scripts/analyze.py`
- `.github/workflows/test.yml`
- `.github/workflows/reflection.yml`
- `.github/workflows/pr_gate.yml`
- `workflow-cookbook/tools/ci/check_governance_gate.py`
- `tools/ci/check_governance_gate.py`
- `.github/ISSUE_TEMPLATE/why-why.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`（@RNA4219 をあなたのハンドルに調整）
- `docs/safety.md`
- `workflow-cookbook/logs/test.jsonl`（ダミー。最初の動作確認用）
- `workflow-cookbook/reports/.gitkeep`

`workflow-cookbook/governance/policy.yaml` は CI が参照するテンプレートです。`governance/` 配下を整備する際は、このディレクトリごとコピーし、`governance/policy.yaml` を最新のポリシーで上書きしてください。`pr_gate` ワークフローは `workflow-cookbook/tools/ci/check_governance_gate.py` を `python tools/ci/check_governance_gate.py` で実行します。デフォルトの作業ディレクトリ（`workflow-cookbook/`）からの呼び出しを成立させるため、`workflow-cookbook/tools/ci/` 配下と、ラッパーとして `tools/ci/check_governance_gate.py` の両方を確実にコピーしてください。

## 使い方
1. push or PR → `test` が走り、`workflow-cookbook/logs/test.jsonl` を生成
2. `reflection` が実行され `workflow-cookbook/reports/today.md` を生成
3. 失敗があれば `workflow-cookbook/reports/issue_suggestions.md` から Issue を自動作成
4. 自動修正は **無効**（安全デチューン）。提案を読み、人間が修正PRを作成。

## 注意
- `CODEOWNERS` を適切なユーザー/チームに設定してください。
- `workflow-cookbook/reflection.yaml` の `analysis.max_tokens` を 0 にしているため、初日は LLM を使いません。
  必要に応じて `engine: llm` と合わせて有効化してください。
