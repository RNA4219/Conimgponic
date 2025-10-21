# Threat Model (Abbrev)
- Spoofing: Local API 偽装 → 接続先は localhost のみ（CSP）。UIでURL変更時はユーザ明示操作が必要。
- Tampering: I/O → PWAは同一オリジンのみに限定。DL/UL時は拡張子/サイズ検証（TODO）。
- Info Disclosure: 外部送信なし（CSP）。
- DoS: ストリームサイズ・行数上限を実装予定（TODO）。
- Repudiation: runs/ 証跡は v1.2 で導入。
