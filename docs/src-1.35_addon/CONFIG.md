# CONFIG — 設定項目

- `conimg.autosave.enabled`: boolean（def: true）
- `conimg.autosave.historyLimit`: number（def: 20）
- `conimg.autosave.sizeLimitMB`: number（def: 50）
- `conimg.merge.threshold`: number（0–1、def: 0.72）
- `conimg.plugins.enable`: boolean（def: false）
- `conimg.view.default`: "grid" | "mosaic" | "timeline" | "kanban"（def: "grid"）
- `conimg.export.lineEnding`: "LF" | "CRLF"（def: "LF"）

## フラグ優先順位（1.35 add-on）

AutoSave / 精緻マージのフェーズガードは以下の順で値を解決する。

1. `import.meta.env` / `process.env`
2. VS Code Workspace 設定（`conimg.*`）
3. `localStorage`
4. `DEFAULT_FLAGS`

`conimg.autosave.enabled` と `conimg.merge.threshold` は `resolveFlags()` に集約され、FlagSnapshot.source により Collector テレメトリへ出典が渡る。
