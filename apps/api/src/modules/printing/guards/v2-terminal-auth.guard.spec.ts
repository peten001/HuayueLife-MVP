import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TerminalHeartbeatAuthGuard } from './terminal-heartbeat-auth.guard';
import { V2TerminalAuthGuard, bearerTerminalToken } from './v2-terminal-auth.guard';

const secret = 'a'.repeat(43);
const token = `yt1.67.${secret}`;

describe('V2 terminal authentication', () => {
  it('accepts the exact Bearer scheme only on V2 routes', async () => {
    const credentials = {
      authenticateV2: jest.fn().mockResolvedValue({ id: 67n, merchantId: 7n }),
    };
    const request = requestWithAuthorization(`Bearer ${token}`);
    const guard = new V2TerminalAuthGuard(credentials as never);

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(credentials.authenticateV2).toHaveBeenCalledWith(token);
    expect(request.terminal).toEqual({ id: 67n, merchantId: 7n });
  });

  it.each([
    undefined,
    `Terminal ${token}`,
    `bearer ${token}`,
    `Bearer yt1.0.${secret}`,
    `Bearer yt1.9223372036854775808.${secret}`,
    `Bearer yt1.67.${'a'.repeat(42)}`,
  ])('rejects malformed or legacy V2 authorization %p', async (authorization) => {
    const credentials = { authenticateV2: jest.fn() };
    const guard = new V2TerminalAuthGuard(credentials as never);

    await expect(
      guard.canActivate(context(requestWithAuthorization(authorization))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(credentials.authenticateV2).not.toHaveBeenCalled();
  });

  it('keeps the shared heartbeat compatible with legacy Terminal and V2 Bearer', async () => {
    const credentials = {
      authenticate: jest.fn().mockResolvedValue({ id: 67n, merchantId: 7n }),
      authenticateV2: jest.fn().mockResolvedValue({ id: 67n, merchantId: 7n }),
    };
    const guard = new TerminalHeartbeatAuthGuard(credentials as never);

    await expect(
      guard.canActivate(context(requestWithAuthorization(`Terminal ${token}`))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context(requestWithAuthorization(`Bearer ${token}`))),
    ).resolves.toBe(true);
    expect(credentials.authenticate).toHaveBeenNthCalledWith(1, token);
    expect(credentials.authenticateV2).toHaveBeenCalledWith(token);
  });

  it('parses no other authorization schemes as a V2 terminal token', () => {
    expect(bearerTerminalToken(`Bearer ${token}`)).toBe(token);
    expect(bearerTerminalToken(`Terminal ${token}`)).toBeNull();
    expect(bearerTerminalToken(`Bearer merchant-jwt`)).toBeNull();
  });
});

function requestWithAuthorization(authorization: string | undefined) {
  return {
    header: jest.fn().mockReturnValue(authorization),
    terminal: undefined as unknown,
  };
}

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
