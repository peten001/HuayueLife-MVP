import { ConflictException, ExecutionContext } from '@nestjs/common';
import { ActiveTerminalGuard } from './active-terminal.guard';

describe('ActiveTerminalGuard', () => {
  const guard = new ActiveTerminalGuard();

  it('allows an ACTIVE terminal to use execution routes', () => {
    expect(guard.canActivate(contextWithStatus('ACTIVE'))).toBe(true);
  });

  it('returns a reversible TERMINAL_DISABLED conflict without invalidating auth', () => {
    try {
      guard.canActivate(contextWithStatus('DISABLED'));
      throw new Error('expected guard to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'TERMINAL_DISABLED' }),
      );
    }
  });
});

function contextWithStatus(status: 'ACTIVE' | 'DISABLED') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ terminal: { status } }),
    }),
  } as unknown as ExecutionContext;
}
