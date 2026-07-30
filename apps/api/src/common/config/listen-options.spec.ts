import { resolveListenOptions } from './listen-options';

describe('resolveListenOptions', () => {
  it('uses the production-compatible default when HOST is absent', () => {
    expect(resolveListenOptions({})).toEqual({ port: 3001, host: undefined });
  });

  it('accepts an explicit loopback host for a shadow process', () => {
    expect(resolveListenOptions({ PORT: '3901', HOST: '127.0.0.1' })).toEqual({
      port: 3901,
      host: '127.0.0.1',
    });
  });

  it('does not pass invalid ports to Nest listen', () => {
    expect(resolveListenOptions({ PORT: 'not-a-port' })).toEqual({ port: 3001, host: undefined });
  });
});
