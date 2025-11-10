import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MergeDock } from '../../src/components/MergeDock';
import { FlagSnapshot } from '../../src/config/flags';
import * as domain from '../../src/components/merge-dock/domain';

// モックデータ
const mockFlagsStable: Pick<FlagSnapshot, 'merge'> = {
  merge: {
    precision: 'stable',
    source: 'default',
    errors: [],
  },
};

const mockFlagsBeta: Pick<FlagSnapshot, 'merge'> = {
  merge: {
    precision: 'beta',
    source: 'default',
    errors: [],
  },
};

const mockFlagsLegacy: Pick<FlagSnapshot, 'merge'> = {
  merge: {
    precision: 'legacy',
    source: 'default',
    errors: [],
  },
};

const mockAutoSaveEnabled = true;

describe('MergeDock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders correctly with default props', () => {
    render(
      <MergeDock
        flags={mockFlagsStable}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    expect(screen.getByText('Compiled')).toBeInTheDocument();
    expect(screen.getByText('Shot')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(screen.getByText('Golden')).toBeInTheDocument();
  });

  // AutoSave ハートビートのテストケース
  it('handles AutoSave heartbeat updates', async () => {
    const mockStopHeartbeat = vi.fn();
    const mockStartHeartbeat = vi.spyOn(domain, 'startMergeDockAutoSaveHeartbeat').mockImplementation((_window, callback) => {
      // 初回呼び出し
      callback({ autoSave: { flushNow: vi.fn(), lastSuccessAt: 1000 }, now: 1000 });
      // 2回目の呼び出しをシミュレート
      vi.advanceTimersByTime(10000); // heartbeatIntervalMs: 10_000 に合わせる
      callback({ autoSave: { flushNow: vi.fn(), lastSuccessAt: 11000 }, now: 11000 });
      return mockStopHeartbeat;
    });

    render(
      <MergeDock
        flags={mockFlagsStable}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );

    await waitFor(() => {
      expect(mockStartHeartbeat).toHaveBeenCalled();
      // AutoSave ステートが更新されたことを確認するアサーションを追加
      // 例: expect(screen.getByTestId('merge-dock')).toHaveAttribute('data-autosave-last-success', '11000');
    });
  });

  // precision 切替のテストケース
  it('handles precision changes and tab transitions', () => {
    const { rerender } = render(
      <MergeDock
        flags={mockFlagsLegacy}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    // legacy の場合、Diff タブは表示されない
    expect(screen.queryByText('Diff')).not.toBeInTheDocument();

    // precision を beta に変更
    rerender(
      <MergeDock
        flags={mockFlagsBeta}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    // beta の場合、Diff (Beta) タブが表示される
    expect(screen.getByText('Diff (Beta)')).toBeInTheDocument();

    // precision を stable に変更
    rerender(
      <MergeDock
        flags={mockFlagsStable}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    // stable の場合、Diff タブが表示される (Beta バッジなし)
    expect(screen.getByText('Diff')).toBeInTheDocument();
    expect(screen.queryByText('Diff (Beta)')).not.toBeInTheDocument();
  });

  // フラグ連携のテストケース
  it('integrates with feature flags for diff merge visibility and beta badge', () => {
    const { rerender } = render(
      <MergeDock
        flags={mockFlagsLegacy}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    // legacy の場合、Diff タブは表示されない
    expect(screen.queryByText('Diff')).not.toBeInTheDocument();

    rerender(
      <MergeDock
        flags={mockFlagsBeta}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    // beta の場合、Diff (Beta) タブが表示される
    expect(screen.getByText('Diff (Beta)')).toBeInTheDocument();

    rerender(
      <MergeDock
        flags={mockFlagsStable}
        autoSaveEnabled={mockAutoSaveEnabled}
      />
    );
    // stable の場合、Diff タブが表示される (Beta バッジなし)
    expect(screen.getByText('Diff')).toBeInTheDocument();
    expect(screen.queryByText('Diff (Beta)')).not.toBeInTheDocument();
  });
});
