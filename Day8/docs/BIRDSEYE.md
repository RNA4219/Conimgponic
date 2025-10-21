# Day8 Birdseye フォールバック手順

Day8 では [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) に従い、Birdseye の index/caps/hot を用いた最小読込を必須としています。本ページは Katamari 版 `docs/BIRDSEYE.md` の構成を踏襲し、Guardrails の Birdseye セクションから参照した際に Day8 で必要となる確認手順を集約したフォールバックガイドです。`docs/birdseye/index.json` の `generated_at` が古い、対象ノードの Capsule が欠損している、`codemap.update` が実行できないといった例外時に参照してください。

## 1. フォールバック適用条件
- `docs/birdseye/index.json.generated_at` が最新コミットより古く、Guardrails が求めるインデックス整合性を満たせない。
- `docs/birdseye/index.json.edges` に対象ノードが存在しない、もしくは接続が欠落しており ±1 hop の追跡ができない。
- 対応する `docs/birdseye/caps/*.json` や `docs/birdseye/hot.json` が欠損・旧版のままで、再生成ツール（`codemap.update`）を即時に実行できない。

上記のいずれかに該当した場合は、ここに記載のフォールバックのみで暫定対処し、恒久対応として JSON を再生成するタスクを併走させてください。

## 2. Guardrails からの参照順
Guardrails では「Birdseye の人間向け資料は補助位置付け」と定義されています。手動補完が必要になった場合も、以下の順序で参照し最小読込の流れを崩さないでください。

1. **ガードレール基準の確認** — [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md) の Birdseye セクションを読み、index → caps → hot → `generated_at` 同期という原則を再確認する。
2. **Day8 索引の前提確認** — [docs/ROADMAP_AND_SPECS.md](ROADMAP_AND_SPECS.md) の「Birdseye 反映 4 ステップ」で Day8 固有の整合チェック項目を把握する。
3. **インデックスの現状把握** — `docs/birdseye/index.json` を開き、対象ノードの `nodes` と `edges` を特定する。
4. **Capsule の補完** — 抽出したノードに対応する `docs/birdseye/caps/<path>.json` を参照し、欠損している場合は [docs/birdseye/README.md](birdseye/README.md) のスキーマ説明を基に暫定的に補う。
5. **ホットリストの優先度確認** — `docs/birdseye/hot.json` を確認し、該当ノードの優先参照理由やリスクを把握する。

## 3. `edges` チェックポイント
フォールバック時は ±1 hop で必要資料を洗い出し、Guardrails が要求する「最短経路」の原則を守ります。

1. **起点設定** — 直近で触れたファイルやノード ID を起点に、`docs/birdseye/index.json.edges` から接続エッジを検索する。
2. **±1 hop 集合化** — 起点に直接接続するノードを一次集合として記録し、入口（索引/README）、中核（仕様/ガードレール）、補助（ガイド/例示）の順に並べる。
3. **経路の最短化** — 追加の参照が必要な場合でも ±1 hop 内で完結するかを確認し、±2 hop へ拡張する際は理由と対象ノードをメモ化する。
4. **欠損検知** — ノードやエッジが見つからない場合は `docs/ROADMAP_AND_SPECS.md` の Birdseye 反映 4 ステップに従い、恒久対応としてインデックス再生成を計画する。

## 4. Capsule / Hot 補完メモ
- Capsule を手動で補完する際は、`summary`・`maintenance`・`refresh_hint` を最低限更新し、再生成後に差分を吸収できるようコメントを残す。
- ホットリストを暫定更新した場合は `reason` と `generated_at` を明記し、正式更新時に `index.json` と同じタイムスタンプへ揃える。
- 手動補完のメモは PR 説明やコミットメッセージに残し、Birdseye 正式運用へ戻す手順を共有する。

## 5. 関連ドキュメント
- [docs/birdseye/README.md](birdseye/README.md): Birdseye 運用全体像と JSON スキーマ。
- [docs/ROADMAP_AND_SPECS.md](ROADMAP_AND_SPECS.md): Birdseye 反映 4 ステップと Day8 索引ルール。
- [workflow-cookbook/GUARDRAILS.md](../workflow-cookbook/GUARDRAILS.md): Guardrails が定義する最小読込とフォールバック要件。
- [workflow-cookbook/tools/codemap/update.py](../workflow-cookbook/tools/codemap/update.py): インデックス再生成ツール。`--emit index+caps` で Capsule と合わせて更新できる。

## 6. 恒久対応チェックリスト
- [ ] `codemap.update` などの再生成ツールを実行し、`docs/birdseye/index.json` と `docs/birdseye/caps/` を最新化した。
- [ ] `docs/birdseye/hot.json` の `generated_at` と優先度を Birdseye 更新内容に合わせて見直した。
- [ ] `docs/ROADMAP_AND_SPECS.md` と [docs/birdseye/README.md](birdseye/README.md) に恒久対応の差分を反映し、フォールバックが不要になったことを明示した。
- [ ] レビュー時に本ページを参照し、フォールバックから正式運用へ戻したことをコミュニケーションした。
