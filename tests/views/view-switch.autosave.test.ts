import test from 'node:test'

/**
 * RED テスト計画: ビュー切替・AutoSave インジケータ・Diff ハイライトの一貫性を担保。
 * - Grid→Mosaic 切替時に AutoSaveIndicator の `phase` / `pendingBytes` が保持されること。
 * - Mosaic→Timeline 切替時に Diff ハイライト対象カードが選択状態を維持すること。
 * - Timeline→Kanban 切替後に仮想スクロールが保存済みのズーム／スクロール座標を復元すること。
 * - カンバン列間 D&D 後に `snapshot()` の `phase` が `awaiting-lock` → `saved` へ遷移し、インジケータと一致すること。
 * - キーボード操作（PgUp/PgDn）で 3 ペイン構成が崩れず、AutoSaveIndicator が `phase='debouncing'` を反映すること。
 */
test.todo('ビュー切替時に AutoSaveIndicator の状態を引き継ぐ')
test.todo('Diff ハイライトが Mosaic と Timeline 間で一致する')
test.todo('タイムライン状態を Kanban ビューで復元する仮想スクロールを検証する')
test.todo('Kanban 列移動で AutoSave フェーズとインジケータが同期する')
test.todo('キーボード操作でも AutoSaveIndicator と 3 ペイン構成が崩れない')
