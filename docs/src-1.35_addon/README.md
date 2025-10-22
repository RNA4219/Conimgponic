# Conimgponic — VS Code 拡張版 API 仕様 追補（v1.35）

本追補は、**PWA→VS Code拡張（CustomEditor + Webview）移行**時に必要となる**API契約の詳細**を定義します。  
対象: **v1.0**。IDE×LLM連携は後段ですが、**受け口（`net.fetch`ゲート／`gen.*`メッセージ）**を先に規定します。

- 作成日: 2025-10-22
- 収録: `docs/spec-ext/API-CONTRACT-EXT.md`（中心）、実装サンプル（拡張・Webview・platform差し替え）
