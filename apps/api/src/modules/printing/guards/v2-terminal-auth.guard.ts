import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TerminalCredentialsService } from '../services/terminal-credentials.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { RequestWithTerminal } from '../types/terminal-auth';

@Injectable()
export class V2TerminalAuthGuard implements CanActivate {
  constructor(private readonly credentials: TerminalCredentialsService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithTerminal>();
    const token = bearerTerminalToken(request.header('authorization'));
    if (!token) this.unauthorized();
    request.terminal = await this.credentials.authenticateV2(token);
    return true;
  }

  private unauthorized(): never {
    throw new UnauthorizedException({
      code: PRINTING_ERROR_CODES.TERMINAL_AUTH_INVALID,
      message: 'V2 终端凭据无效或已失效',
    });
  }
}

export function bearerTerminalToken(authorization: string | undefined) {
  const match = authorization?.match(
    /^Bearer\s+(yt1\.([1-9][0-9]{0,18})\.[A-Za-z0-9_-]{43})$/,
  );
  if (!match || BigInt(match[2]) > 9_223_372_036_854_775_807n) return null;
  return match[1];
}
