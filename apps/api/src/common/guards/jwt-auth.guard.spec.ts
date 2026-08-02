import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

function contextWithAuthorization(authorization?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => name === 'authorization' ? authorization : undefined,
      }),
    }),
  } as never;
}

describe('JwtAuthGuard authentication failure codes', () => {
  it('distinguishes missing, expired, and invalid bearer tokens', () => {
    const verify = jest.fn();
    const guard = new JwtAuthGuard({ verify } as unknown as JwtService);

    expectAuthCode(() => guard.canActivate(contextWithAuthorization()), 'AUTH_TOKEN_MISSING');

    const expired = new Error('jwt expired');
    expired.name = 'TokenExpiredError';
    verify.mockImplementationOnce(() => { throw expired; });
    expectAuthCode(
      () => guard.canActivate(contextWithAuthorization('Bearer expired-token')),
      'AUTH_TOKEN_EXPIRED',
    );

    verify.mockImplementationOnce(() => { throw new Error('invalid signature'); });
    expectAuthCode(
      () => guard.canActivate(contextWithAuthorization('Bearer invalid-token')),
      'AUTH_TOKEN_INVALID',
    );
  });
});

function expectAuthCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error('Expected JwtAuthGuard to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({ code });
  }
}
