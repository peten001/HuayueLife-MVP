import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { RequestWithTerminal } from '../types/terminal-auth';

/**
 * Reversible DISABLED terminals keep a valid credential for heartbeat/config,
 * but may not claim, start or report execution work. REVOKED/expired/rotated
 * credentials are rejected earlier by TerminalAuthGuard with HTTP 401.
 */
@Injectable()
export class ActiveTerminalGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithTerminal>();
    if (request.terminal?.status !== 'ACTIVE') {
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.TERMINAL_DISABLED,
        message: '终端已停用；凭据仍保留，可继续获取配置并等待管理员重新启用',
      });
    }
    return true;
  }
}
