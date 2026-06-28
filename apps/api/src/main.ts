import { Logger, ValidationPipe } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  const port = Number(process.env.PORT ?? 3001);

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 't/:token', method: RequestMethod.GET }],
  });
  const uploadsRoot = join(process.cwd(), 'uploads');
  const reportsRoot = join(process.cwd(), 'public', 'reports');
  app.use('/api/v1/uploads', express.static(uploadsRoot));
  app.use('/uploads', express.static(uploadsRoot));
  app.use('/reports', express.static(reportsRoot));
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
