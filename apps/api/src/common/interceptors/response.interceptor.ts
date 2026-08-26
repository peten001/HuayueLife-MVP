import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiSuccessResponse } from '../dto/api-response.dto';
import { RequestWithContext } from '../types/request.type';
import { buildApiSuccessResponse } from '../utils/api-success-response';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<unknown>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<unknown>> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    return next.handle().pipe(
      map((data) => buildApiSuccessResponse(data, request.requestId)),
    );
  }
}
