import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithTerminal } from '../types/terminal-auth';

export const CurrentTerminal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithTerminal>();
    return request.terminal;
  },
);
