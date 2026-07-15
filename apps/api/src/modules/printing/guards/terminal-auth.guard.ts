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
export class TerminalAuthGuard implements CanActivate {
  constructor(private readonly credentials: TerminalCredentialsService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithTerminal>();
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Terminal\s+(yt1\.[0-9]+\.[A-Za-z0-9_-]{32,})$/);
    if (!match) this.unauthorized();
    request.terminal = await this.credentials.authenticate(match[1]);
    return true;
  }

  private unauthorized(): never {
    throw new UnauthorizedException({
      code: PRINTING_ERROR_CODES.TERMINAL_AUTH_INVALID,
      message: '终端凭据无效或已失效',
    });
  }
}
