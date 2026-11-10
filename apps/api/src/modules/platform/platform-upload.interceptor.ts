import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalize } from 'rxjs/operators';

const temporaryDirectory = join(tmpdir(), 'yunqiao-platform-uploads');

@Injectable()
class RemoveTemporaryUpload implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ file?: { path?: string } }>();
    return next.handle().pipe(finalize(() => {
      if (request.file?.path) rmSync(request.file.path, { force: true });
    }));
  }
}

/** Files stream to private temporary storage; size is not a business rule. */
export function PlatformUpload() {
  mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 });
  return UseInterceptors(RemoveTemporaryUpload, FileInterceptor('file', {
    dest: temporaryDirectory,
  }));
}
