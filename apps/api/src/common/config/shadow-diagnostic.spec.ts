import { isApiShadowDiagnosticMode } from './shadow-diagnostic';

describe('isApiShadowDiagnosticMode', () => {
  it.each(['true', ' TRUE ', 'TrUe'])('enables only an explicit true value: %s', (value) => {
    expect(isApiShadowDiagnosticMode({ API_SHADOW_DIAGNOSTIC_MODE: value })).toBe(true);
  });

  it.each([undefined, '', 'false', '1', 'yes', 'unexpected'])
  ('keeps normal runtime behavior for non-opt-in value: %s', (value) => {
    expect(isApiShadowDiagnosticMode({ API_SHADOW_DIAGNOSTIC_MODE: value })).toBe(false);
  });
});
