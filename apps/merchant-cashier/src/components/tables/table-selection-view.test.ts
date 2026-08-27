import { describe, expect, it } from 'vitest';
import { resolveTableSelectionView } from './table-selection-view';

describe('mobile table selection view', () => {
  it('opens an available table in the menu without requesting a session mutation', () => {
    expect(resolveTableSelectionView(true, 'AVAILABLE')).toBe('menu');
  });

  it('opens an occupied table in its bill detail', () => {
    expect(resolveTableSelectionView(true, 'IN_USE')).toBeUndefined();
  });

  it('preserves the desktop table-detail workflow', () => {
    expect(resolveTableSelectionView(false, 'AVAILABLE')).toBeUndefined();
  });
});
