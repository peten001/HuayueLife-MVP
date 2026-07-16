import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import AccountMenu from './AccountMenu.vue';

const roleCopies = {
  OWNER: {
    zh: ['老板', '商家主账号'],
    vi: ['Chủ cửa hàng', 'Tài khoản chủ cửa hàng'],
    en: ['Owner', 'Merchant primary account'],
  },
  MANAGER: {
    zh: ['经理', '管理账号'],
    vi: ['Quản lý', 'Tài khoản quản lý'],
    en: ['Manager', 'Manager account'],
  },
  STAFF: {
    zh: ['员工', '员工账号'],
    vi: ['Nhân viên', 'Tài khoản nhân viên'],
    en: ['Staff', 'Staff account'],
  },
} as const;

describe('AccountMenu merchant role identity', () => {
  afterEach(() => setLocale('zh'));

  for (const [role, copies] of Object.entries(roleCopies)) {
    for (const [locale, [title, subtitle]] of Object.entries(copies)) {
      it(`renders ${role} in ${locale} without account identity`, () => {
        setLocale(locale as 'zh' | 'vi' | 'en');
        const wrapper = mount(AccountMenu, {
          props: { role, merchantName: 'Test merchant' },
        });

        expect(wrapper.get('[data-testid="account-role-label"]').text()).toBe(title);
        expect(wrapper.get('[data-testid="account-role-account-label"]').text()).toBe(subtitle);
        expect(wrapper.text()).not.toContain('new-merchant-01');
        expect(wrapper.text()).not.toContain('PRIVATE_PHONE_SHOULD_NOT_RENDER');
      });
    }
  }

  it('falls back to STAFF and emits a non-sensitive warning for an unknown role', () => {
    setLocale('zh');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const wrapper = mount(AccountMenu, {
      props: { role: 'UNEXPECTED_ROLE', merchantName: 'Test merchant' },
    });

    expect(wrapper.get('[data-testid="account-role-label"]').text()).toBe('员工');
    expect(wrapper.get('[data-testid="account-role-account-label"]').text()).toBe('员工账号');
    expect(warning).toHaveBeenCalledWith(
      '[cashier] Unrecognized merchant role; using the STAFF display fallback.',
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain('UNEXPECTED_ROLE');
  });
});
