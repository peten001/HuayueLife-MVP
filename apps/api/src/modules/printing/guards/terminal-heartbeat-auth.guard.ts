import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TerminalCredentialsService } from '../services/terminal-credentials.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { RequestWithTerminal } from '../types/terminal-auth';
import { bearerTerminalToken } from './v2-terminal-auth.guard';

@Injectable()
export class TerminalHeartbeatAuthGuard implements CanActivate {
  constructor(private readonly credentials: TerminalCredentialsService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithTerminal>();
    const authorization = request.header('authorization');
    const legacy = authorization?.match(
      /^Terminal\s+(yt1\.([1-9][0-9]{0,18})\.[A-Za-z0-9_-]{43})$/,
    );
    const legacyToken =
      legacy && BigInt(legacy[2]) <= 9_223_372_036_854_775_807n
        ? legacy[1]
        : null;
    const bearerToken = bearerTerminalToken(authorization);
    const token = legacyToken ?? bearerToken;
    if (!token) this.unauthorized();
    request.terminal = legacyToken
      ? await this.credentials.authenticate(legacyToken)
      : await this.credentials.authenticateV2(bearerToken!);
    return true;
  }

  private unauthorized(): never {
    throw new UnauthorizedException({
      code: PRINTING_ERROR_CODES.TERMINAL_AUTH_INVALID,
      message: '终端凭据无效或已失效',
    });
  }
}
