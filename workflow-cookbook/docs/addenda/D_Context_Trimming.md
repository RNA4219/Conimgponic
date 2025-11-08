# 付録D: コンテキストトリミング指針（Workflow Cookbook）

## 1. アルゴリズム概要

- 対象: OpenAI 互換モデルへ送信する `messages` シーケンス。
- `system` ロールの最初のメッセージを優先保持し、それ以外を新しい順に逆走査して `max_context_tokens` の範囲に収まるまで追加。
- トークン計測は `_TokenCounter` が担当。既存カウンタを渡さない場合は `model` 引数からインスタンス化し、全メッセージの概算トークンを算出。
- トリミング結果は元メッセージを破壊せず、新しいリストを返却する。

## 2. トークン計測戦略

| 状態 | 利用エンコーダ | 概算方法 |
| :--- | :--- | :--- |
| `tiktoken` を解決できた場合 | `encoding_for_model(resolved)` または `cl100k_base` | `encode(content)` の長さにメッセージ定数4トークンを加算 |
| `tiktoken` が利用不可 | `None` | 文字数を4で割った整数＋1にメッセージ定数4トークンを加算 |

- `resolved` には `_MODEL_ALIASES`（例: `gpt-4o`, `gpt-3.5-turbo`）が適用される。
- `_TokenCounter.meta()` は `model`・`encoding`・`uses_tiktoken`・`strategy` を返し、監査ログの補助指標として扱う。

## 3. 指標定義

| 指標名 | 定義 | 備考 |
| :--- | :--- | :--- |
| `compress_ratio` / `compression_ratio` | `output_tokens / input_tokens`。トリミング前後のトークン比率。 | 入力0トークン時は1.0を固定返却。レガシーキー互換のため両名称を同値で保持。 |
| `semantic_retention` | トリミング前後のメッセージテキストを埋め込み、コサイン類似度で算出。 | `semantic_options["embedder"]` が `Callable[[str], Sequence[float]]` のときのみ計測。例外時は0.0で保存。 |
| `input_tokens` | トリミング対象メッセージ群の総トークン数。 | `_TokenCounter` の `count_message` を全件合計。 |
| `output_tokens` | トリミング後メッセージ群の総トークン数。 | `_TokenCounter` の `count_message` を保持対象で合計。 |

## 4. 想定パラメータ

`tools.perf.context_trimmer.trim_messages` の主要引数:

- `messages: Sequence[Mapping[str, Any]]`
  - `{"role": str, "content": Any}` 構造を想定。ミュータブルな参照は内部で `dict` コピーされる。
- `max_context_tokens: int`
  - システムメッセージを含む全体トークン上限。トークン超過時は最新メッセージから間引く。
- `model: str`
  - `_MODEL_ALIASES` を解決後、`_TokenCounter` の `encoding_for_model` 選択に利用。
- `token_counter: _TokenCounter | None = None`
  - 既存インスタンスを共有する場合に指定。`None` なら `model` から初期化。
- `semantic_options: Mapping[str, Any] | None = None`
  - `{"embedder": Callable}` を含む場合に意味保持率を計測。未指定時は統計に含めない。

返却値は下記4キーを含む辞書。

```jsonc
{
  "messages": [MutableMapping],
  "statistics": {
    "compress_ratio": float,
    "compression_ratio": float,
    "input_tokens": int,
    "output_tokens": int,
    "semantic_retention"?: float
  },
  "token_counter": {
    "model": str,
    "encoding": str | null,
    "uses_tiktoken": bool,
    "strategy": "tiktoken" | "heuristic"
  },
  "semantic_options": Mapping[str, Any]
}
```

## 5. 検証手順

- ケースID: [I-04 コンテキストトリミング検証](I_Test_Cases.md#i-04-コンテキストトリミング検証)
- 検証観点:
  1. `_TokenCounter` が `tiktoken` 利用時とフォールバック時で整合したメタ情報を返すか。
  2. `compress_ratio` が `output_tokens / input_tokens` と一致するか。
  3. `semantic_retention` の埋め込み関数が `Sequence[float]` を返さない場合に 0.0 へフォールバックするか。
- 実施例:
  - `python - <<'PY'` で `trim_messages` を呼び出し、`max_context_tokens`・`semantic_options` を変更しながら統計を比較する。
  - `I-04` の手順に従い、テストログと計測値を `docs/TASKS.md` の `Verification` セクションへ貼付する。

> **更新フロー**: 指標や引数が拡張された場合は、本付録と `I-04` を同時更新する。RUNBOOK / CHECKLIST の参照リンクも忘れず整合させること。
