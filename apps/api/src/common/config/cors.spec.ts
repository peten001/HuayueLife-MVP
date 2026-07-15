import { createCorsOptions } from './cors';

describe('createCorsOptions', () => {
  it('allows the exact production admin origin and an explicitly configured cashier candidate', () => {
    const options = createCorsOptions(
      'production',
      'https://cashier.huayueyouxuan.com',
    );
    expect(check(options, 'https://admin.huayueyouxuan.com')).toBe(true);
    expect(check(options, 'https://servicewechat.com')).toBe(true);
    expect(check(options, 'https://cashier.huayueyouxuan.com')).toBe(true);
    expect(check(options, 'https://evil.example')).toBe(false);
    expect(check(options, 'https://cashier.huayueyouxuan.com.evil.example')).toBe(
      false,
    );
    expect(options.credentials).toBe(true);
  });

  it('does not hardcode the cashier candidate before it is configured', () => {
    const options = createCorsOptions('production', undefined);

    expect(check(options, 'https://admin.huayueyouxuan.com')).toBe(true);
    expect(check(options, 'https://cashier.huayueyouxuan.com')).toBe(false);
  });

  it('allows origin-less native requests in production', () => {
    const options = createCorsOptions('production', undefined);
    expect(check(options, undefined)).toBe(true);
  });

  it('allows exact local development origins', () => {
    const options = createCorsOptions('development', undefined);
    expect(check(options, 'http://localhost:5173')).toBe(true);
    expect(check(options, 'http://localhost:5176')).toBe(true);
    expect(check(options, 'http://127.0.0.1:5176')).toBe(true);
    expect(check(options, 'http://localhost:5173.evil.test')).toBe(false);
  });

  it('rejects wildcards, paths, credentials, and cleartext production origins', () => {
    expect(() => createCorsOptions('production', '*')).toThrow(/wildcards/);
    expect(() =>
      createCorsOptions('production', 'https://example.com/path'),
    ).toThrow(/Invalid exact/);
    expect(() =>
      createCorsOptions('production', 'https://user:pass@example.com'),
    ).toThrow(/Invalid exact/);
    expect(() =>
      createCorsOptions('production', 'https://example.com?source=cashier'),
    ).toThrow(/Invalid exact/);
    expect(() =>
      createCorsOptions('production', 'http://cashier.example.com'),
    ).toThrow(/HTTPS/);
  });
});

function check(
  options: ReturnType<typeof createCorsOptions>,
  origin: string | undefined,
) {
  let accepted = false;
  const handler = options.origin;
  if (typeof handler !== 'function') throw new Error('origin callback missing');
  handler(origin as string, (error, value) => {
    accepted = !error && value === true;
  });
  return accepted;
}
