import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiErrorResponse } from '../dto/api-response.dto';
import { RequestWithContext } from '../types/request.type';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithContext>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.resolveMessage(exceptionResponse);
    const code = this.resolveCode(exceptionResponse, status);

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          requestId: request.requestId,
          method: request.method,
          path: request.originalUrl,
          error: exception instanceof Error ? exception.stack : String(exception),
        }),
      );
    }

    const body: ApiErrorResponse = {
      code,
      message,
      data: null,
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      ...this.resolveSafeDetails(exceptionResponse),
    };

    response.status(status).json(body);
  }

  private resolveMessage(response: string | object | undefined): string | string[] {
    if (typeof response === 'string') {
      return response;
    }
    if (response && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string' || Array.isArray(message)) {
        return message as string | string[];
      }
    }
    return 'Internal server error';
  }

  private resolveCode(response: string | object | undefined, status: number): string {
    if (response && typeof response === 'object' && 'code' in response) {
      return String((response as { code: unknown }).code);
    }
    return `HTTP_${status}`;
  }

  private resolveSafeDetails(response: string | object | undefined) {
    if (!response || typeof response !== 'object') return {};
    const value = response as Record<string, unknown>;
    return {
      ...(value.latestState && typeof value.latestState === 'object'
        ? { latestState: value.latestState }
        : {}),
      ...(typeof value.lineKey === 'string' ? { lineKey: value.lineKey } : {}),
      ...(value.code === 'VOID_WHOLE_SESSION_REQUIRED' && typeof value.target === 'string' && /^session:[1-9]\d{0,18}$/.test(value.target)
        ? { target: value.target } : {}),
      ...(typeof value.lockedQuantity === 'number'
        ? { lockedQuantity: value.lockedQuantity }
        : {}),
    };
  }
}
