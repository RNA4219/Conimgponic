# Day8 Birdseye 運用ガイド

## 概要
Day8 の Birdseye は、リポジトリ内の主要ドキュメントとガードレールを鳥瞰的に把握するための可視化レイヤーです。Katamari 版の情報整理フローを踏襲しつつ、Day8 固有の索引（`docs/ROADMAP_AND_SPECS.md`）と安全審査ライン（`docs/safety.md`）を同一ホップ内で辿れるように最適化しています。LLM やレビュー担当者が最小限の読み込みで必要資料へアクセスできるよう、`index.json`・Capsule 群・ホットリストを同期させることが運用の前提です。

推奨参照順序:
1. `docs/ROADMAP_AND_SPECS.md` — Day8 全体像と Birdseye 更新必須ステップの確認。
2. `docs/birdseye/index.json` — Day8 ノード間の鳥瞰マップを把握。
3. `docs/birdseye/caps/` 以下の Capsule JSON — 必要ノードの要約と保守手順を point read。
4. `docs/birdseye/hot.json` — 優先参照ノードと直近リスクのチェック。
5. `docs/BIRDSEYE.md` — Guardrails 参照順と `edges` チェックポイントをまとめたフォールバック手順、および恒久対応チェックリスト。

## JSON ファイル構成（index → caps → hot）
### 1. `docs/birdseye/index.json`
- `nodes`: Birdseye が追跡するファイルと役割の定義。例として `"docs/ROADMAP_AND_SPECS.md"` は `docs/birdseye/caps/docs.ROADMAP_AND_SPECS.md.json` を参照し、Day8 と cookbook 間のクロスリンクを管理します。
- `edges`: ノード間の参照関係。`README.md → docs/ROADMAP_AND_SPECS.md` のように索引動線を可視化します。
- `generated_at`: インデックス再生成の日時。`hot.json` と同じ値に揃えることで履歴を同期します。

### 2. `docs/birdseye/caps/`
- 各ノードの Capsule JSON を格納。要約・保守手順・再生成条件を含みます。
- 代表例: `docs/birdseye/caps/README.md.json`（Day8 ルート README の誘導）、`docs/birdseye/caps/docs.safety.md.json`（安全審査基準）、`docs/birdseye/caps/docs.ROADMAP_AND_SPECS.md.json`（索引と Birdseye 反映 4 ステップ）。
- Capsule を追加・更新した場合は必ず対応する `nodes[*].caps` のパスと内容を一致させます。Capsule ファイル名は `path.with.dots.json` 形式（例: `docs/ROADMAP_AND_SPECS.md` → `docs.ROADMAP_AND_SPECS.md.json`）。

### 3. `docs/birdseye/hot.json`
- 優先参照すべきノードのリスト。`docs/ROADMAP_AND_SPECS.md` や `docs/safety.md` のような判断基準を即座に辿れるようピックアップします。
- `generated_at` は `index.json` と同じタイムスタンプを設定し、Birdseye 再生成の整合を保証します。

## 更新手順
1. **差分検知** — Guardrails または Day8 ドキュメントに変更が入ったら、影響範囲のノードを `docs/birdseye/index.json` で特定します。
2. **インデックス更新** — ノード追加・役割変更・エッジ更新を `index.json` に反映し、`mtime` を変更検知時刻へ合わせます。
3. **Capsule 更新** — 対象ノードの Capsule（例: `docs/birdseye/caps/docs.ROADMAP_AND_SPECS.md.json`）を修正し、要約・refresh 手順を最新化します。
4. **ホットリスト見直し** — 優先度が変わった場合は `docs/birdseye/hot.json` の対象と `reason` を更新します。
5. **generated_at 揃え** — `index.json` と `hot.json` の `generated_at` を同一時刻へ更新し、再生成の履歴を同期します。
6. **ツール実行** — 自動再生成が必要な場合は `python workflow-cookbook/tools/codemap/update.py --targets docs/birdseye/index.json,workflow-cookbook/docs/birdseye/index.json --emit index+caps` を使用し、必要に応じて `--dry-run` で差分確認後に適用します。`--targets` はカンマ区切りで複数指定でき、空要素は無視されます。`--emit` は `index` / `caps` / `index+caps` のいずれかを選択でき、インデックスを書き換えた場合は同じ階層の `hot.json` の `generated_at` も自動で同期されます。

## Guardrails 連携
- `workflow-cookbook/GUARDRAILS.md` の Birdseye セクションで定義された「インデックス → Capsule → ホットリスト → generated_at 同期」の順序を Day8 でも必須ルールとします。
- Guardrails を更新した PR では、`docs/ROADMAP_AND_SPECS.md` と本 README を同じコミットで整合させ、Birdseye の `nodes` / `caps` / `hot` が最新ガイドラインに従っていることを確認します。
- Birdseye の自動再生成が行えない場合は、[docs/BIRDSEYE.md](../BIRDSEYE.md) の「Guardrails からの参照順」と「`edges` チェックポイント」を順に確認し、±1 hop 抽出と Capsule/Hot のフォールバック手順に従ってください。
- Day8 の安全審査 (`docs/safety.md`) やロードマップ (`docs/ROADMAP_AND_SPECS.md`) に差分が生じた場合、必ず対応する Capsule とホットリストを同時更新し、Guardrails 側の監査記録と `generated_at` を同期してください。
