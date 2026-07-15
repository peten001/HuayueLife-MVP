import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CartModule } from './modules/cart/cart.module';
import { HealthModule } from './modules/health/health.module';
import { MerchantProfileModule } from './modules/merchant-profile/merchant-profile.module';
import { MerchantStaffModule } from './modules/merchant-staff/merchant-staff.module';
import { MerchantOrdersModule } from './modules/merchant-orders/merchant-orders.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderChatModule } from './modules/order-chat/order-chat.module';
import { PublicMerchantsModule } from './modules/public-merchants/public-merchants.module';
import { MerchantReportsModule } from './modules/merchant-reports/merchant-reports.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PrintersModule } from './modules/printers/printers.module';
import { PrintingModule } from './modules/printing/printing.module';
import { QrModule } from './modules/qr/qr.module';
import { TableSessionsModule } from './modules/table-sessions/table-sessions.module';
import { TablesModule } from './modules/tables/tables.module';
import { AppConfigModule } from './modules/app-config/app-config.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'development-only-secret-change-me',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') ?? '7d',
        },
      }),
    }),
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    MerchantProfileModule,
    MerchantStaffModule,
    MerchantOrdersModule,
    UploadsModule,
    CategoriesModule,
    CartModule,
    ProductsModule,
    OrdersModule,
    OrderChatModule,
    TablesModule,
    TableSessionsModule,
    PublicMerchantsModule,
    MerchantReportsModule,
    PlatformModule,
    PrintersModule,
    PrintingModule,
    QrModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, RequestLoggerMiddleware).forRoutes('*');
  }
}
