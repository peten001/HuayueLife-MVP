import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TerminalAuthGuard } from './terminal-auth.guard';

describe('TerminalAuthGuard', () => {
  it('accepts only the exact Terminal scheme and canonical 43-character secret', async () => {
    const credentials = {
      authenticate: jest.fn().mockResolvedValue({ id: 67n, merchantId: 7n }),
    };
    const request = {
      header: jest
        .fn()
        .mockReturnValue(`Terminal yt1.67.${'a'.repeat(43)}`),
      terminal: undefined,
    };
    const guard = new TerminalAuthGuard(credentials as never);

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(credentials.authenticate).toHaveBeenCalledWith(
      `yt1.67.${'a'.repeat(43)}`,
    );
    expect(request.terminal).toEqual({ id: 67n, merchantId: 7n });
  });

  it.each([
    undefined,
    `Bearer yt1.67.${'a'.repeat(43)}`,
    `Terminal yt1.67.${'a'.repeat(42)}`,
    `Terminal yt1.67.${'a'.repeat(44)}`,
    `Terminal yt1.67.${'a'.repeat(42)}=`,
    `Terminal yt1.0.${'a'.repeat(43)}`,
    `Terminal yt1.9223372036854775808.${'a'.repeat(43)}`,
    `Terminal yt1.${'9'.repeat(20)}.${'a'.repeat(43)}`,
  ])('rejects malformed authorization %p before credential lookup', async (header) => {
    const credentials = { authenticate: jest.fn() };
    const guard = new TerminalAuthGuard(credentials as never);

    await expect(
      guard.canActivate(context({ header: jest.fn().mockReturnValue(header) })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(credentials.authenticate).not.toHaveBeenCalled();
  });
});

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
