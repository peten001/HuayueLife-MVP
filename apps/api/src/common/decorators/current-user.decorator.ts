import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithContext } from '../types/request.type';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithContext>().user,
);
