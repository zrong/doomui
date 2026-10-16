import { describe, expect, it } from 'vitest';
import { stableSelectionKey } from '../source/core/selection-key';

describe('stableSelectionKey', () => {
  it('treats reordered and duplicated asset selections as the same snapshot', () => {
    expect(stableSelectionKey(['sprite-b', 'sprite-a', 'sprite-a']))
      .toBe(stableSelectionKey(['sprite-a', 'sprite-b']));
  });

  it('changes when the selected asset set changes', () => {
    expect(stableSelectionKey(['sprite-a'])).not.toBe(stableSelectionKey(['sprite-b']));
    expect(stableSelectionKey([])).not.toBe(stableSelectionKey(['sprite-a']));
  });
});
