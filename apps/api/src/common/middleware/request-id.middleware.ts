import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Response, NextFunction } from 'express';
import { RequestWithContext } from '../types/request.type';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction) {
    const incomingRequestId = request.header('x-request-id');
    request.requestId = incomingRequestId?.slice(0, 128) || randomUUID();
    response.setHeader('x-request-id', request.requestId);
    next();
  }
}
