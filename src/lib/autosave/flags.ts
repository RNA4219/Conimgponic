import type { FlagSnapshot } from '../../config/flags'
import type { AutoSavePhaseGuardSnapshot } from '../autosave'

/**
 * FlagSnapshotからAutoSaveに必要な設定情報を抽出する
 * 
 * @param flagSnapshot - 全体のフラグスナップショット
 * @returns AutoSaveに必要なガード情報
 */
export function resolveAutoSaveFromFlagSnapshot(
  flagSnapshot?: FlagSnapshot
): AutoSavePhaseGuardSnapshot {
  if (!flagSnapshot) {
    // フラグスナップショットがない場合はデフォルト値を使用
    return {
      featureFlag: {
        value: false, // 既定で無効
        source: 'default'
      },
      optionsDisabled: false
    }
  }

  return {
    featureFlag: {
      value: flagSnapshot.autosave.value, // autosave.valueはboolean型として有効
      source: flagSnapshot.autosave.source
    },
    optionsDisabled: false // FlagSnapshotからoptionsDisabledは取得しない
  }
}