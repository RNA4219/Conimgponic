# コントリビューションメモ

私と AI でコツコツ回しているリポジトリです。まずは手短に現状を把握してから、必要なメモを残していきましょう。詳細が必要になったときは [`docs/ROADMAP_AND_SPECS.md`](docs/ROADMAP_AND_SPECS.md) から辿れば全体像を確認できます。

## 進め方（ざっくり）
1. 気になる点をメモする
   - 仕様や背景は索引ページで確認。
   - 安全策や運用ルールは [`workflow-cookbook/GUARDRAILS.md`](workflow-cookbook/GUARDRAILS.md) と [`workflow-cookbook/RUNBOOK.md`](workflow-cookbook/RUNBOOK.md) を参照。
2. Issue を立てる
   - `.github/ISSUE_TEMPLATE/` に沿って「背景・やりたいこと・確認方法」を書く。
   - 小さな改善ならドラフトでも OK。後で整えれば十分です。
3. 手を動かす
   - `INSTALL.md` の環境構築を済ませ、差分は最小限に。
   - `mypy --strict`、`ruff`、`pytest`、`node --test` を通す（いつも通りの並びで）。
4. PR を出す
   - チェックリストは `.github/PULL_REQUEST_TEMPLATE.md` に従って淡々と埋める。
   - ログやレポートは `workflow-cookbook/` 配下にまとめる。

## ふりかえりとマナー
- 人と AI の二人三脚なので、[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) の内容を軽く読んでおく。
- 気付いたことは雑にでも記録し、次のループで整える。
- ガバナンス系の設定をいじるときは `governance/` を確認し、必要なら Issue 経由で相談する。
