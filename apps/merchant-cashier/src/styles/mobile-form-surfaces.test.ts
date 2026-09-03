import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashierStyles = readFileSync(resolve(process.cwd(), 'src/styles/cashier.css'), 'utf8');
const adjustmentDialog = readFileSync(
  resolve(process.cwd(), 'src/components/settlement/SettlementAdjustmentDialog.vue'),
  'utf8',
);
const loginPage = readFileSync(resolve(process.cwd(), 'src/pages/LoginPage.vue'), 'utf8');

describe('mobile cashier form surfaces', () => {
  it('uses light mobile tokens for the settlement adjustment dialog', () => {
    expect(adjustmentDialog).toMatch(
      /@media \(max-width: 899px\)[\s\S]*--settlement-dialog-bg:\s*var\(--mobile-v2-surface, var\(--cashier-surface\)\);/,
    );
    expect(adjustmentDialog).toMatch(
      /@media \(max-width: 899px\)[\s\S]*--settlement-text:\s*var\(--mobile-v2-text, var\(--cashier-text\)\);/,
    );
    expect(adjustmentDialog).toMatch(/@media \(max-width: 899px\)[\s\S]*color-scheme:\s*light;/);
  });

  it('keeps mobile login controls at the iOS no-auto-zoom font size', () => {
    expect(cashierStyles).toMatch(
      /@media \(max-width: 620px\)[\s\S]*\.auth-input input,\s*\.auth-language select\s*\{\s*font-size:\s*16px;\s*\}/,
    );
  });

  it('keeps the staff cashier login separate from the owner admin portal', () => {
    expect(loginPage).not.toContain('auth-admin-link');
    expect(loginPage).not.toContain('auth.backToAdmin');
    expect(loginPage).not.toContain('merchantAdminUrl');
  });
});
