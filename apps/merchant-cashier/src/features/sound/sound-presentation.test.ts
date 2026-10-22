import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDesktopSoundPresentation } from './sound-presentation';
afterEach(() => vi.unstubAllGlobals());
describe('desktop-only audio boundary', () => {
  it.each([[390, false], [768, false], [899, false], [900, true], [1366, true]] as const)('uses the released shell breakpoint at %s px', (width, expected) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 899px)' && width <= 899 }));
    expect(isDesktopSoundPresentation()).toBe(expected);
  });
});
