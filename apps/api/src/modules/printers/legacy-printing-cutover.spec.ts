import { GoneException } from '@nestjs/common';
import { Socket } from 'node:net';
import { MerchantOrdersController } from '../merchant-orders/merchant-orders.controller';
import { PrintingFeatureFlagsService } from '../printing/services/printing-feature-flags.service';
import { PrintersController } from './printers.controller';
import { PrintersService } from './printers.service';

describe('Legacy printing cutover', () => {
  const disabledFlags = {
    assertLegacyPrintingEnabled: jest.fn(() => {
      throw new GoneException({
        code: 'LEGACY_PRINTING_DISABLED',
        message: '旧打印功能已停用，请使用打印中心。当前执行端尚未接入。',
      });
    }),
  };

  beforeEach(() => {
    disabledFlags.assertLegacyPrintingEnabled.mockClear();
  });

  it('blocks every legacy printer mutation before its service is called', () => {
    const service = {
      getPrintersByMerchant: jest.fn(),
      createPrinter: jest.fn(),
      updatePrinter: jest.fn(),
      deletePrinter: jest.fn(),
      testPrint: jest.fn(),
    };
    const controller = new PrintersController(
      service as never,
      disabledFlags as never,
    );

    const actions = [
      () => controller.list(7n),
      () => controller.create(7n, {} as never),
      () => controller.update(7n, { id: '11' }, {} as never),
      () => controller.delete(7n, { id: '11' }),
      () => controller.test(7n, { id: '11' }),
    ];

    for (const action of actions) {
      expect(action).toThrow(GoneException);
    }
    expect(service.getPrintersByMerchant).not.toHaveBeenCalled();
    expect(service.createPrinter).not.toHaveBeenCalled();
    expect(service.updatePrinter).not.toHaveBeenCalled();
    expect(service.deletePrinter).not.toHaveBeenCalled();
    expect(service.testPrint).not.toHaveBeenCalled();
  });

  it('blocks the legacy manual order print before its service is called', () => {
    const orders = {};
    const printers = { reprintOrder: jest.fn() };
    const controller = new MerchantOrdersController(
      orders as never,
      printers as never,
      disabledFlags as never,
    );

    expect(() =>
      controller.print(7n, { id: '21' }, { printerIds: ['11'] }),
    ).toThrow(GoneException);
    expect(printers.reprintOrder).not.toHaveBeenCalled();
  });

  it('keeps the old controller behavior available when rollback is enabled', () => {
    const enabledFlags = { assertLegacyPrintingEnabled: jest.fn() };
    const printerService = {
      createPrinter: jest.fn().mockReturnValue({ id: 11n }),
      testPrint: jest.fn().mockReturnValue({ success: true }),
    };
    const printersController = new PrintersController(
      printerService as never,
      enabledFlags as never,
    );
    const orderPrintService = {
      reprintOrder: jest.fn().mockReturnValue({ total: 1 }),
    };
    const ordersController = new MerchantOrdersController(
      {} as never,
      orderPrintService as never,
      enabledFlags as never,
    );

    expect(printersController.create(7n, {} as never)).toEqual({ id: 11n });
    expect(printersController.test(7n, { id: '11' })).toEqual({ success: true });
    expect(
      ordersController.print(7n, { id: '21' }, { printerIds: ['11'] }),
    ).toEqual({ total: 1 });
    expect(printerService.createPrinter).toHaveBeenCalledWith(7n, {});
    expect(printerService.testPrint).toHaveBeenCalledWith(7n, 11n);
    expect(orderPrintService.reprintOrder).toHaveBeenCalledWith(7n, 21n, [11n]);
  });

  it('defends the legacy service itself before config, log or socket work', async () => {
    const socketConnect = jest.spyOn(Socket.prototype, 'connect');
    const prisma = {
      printerSetting: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      order: { findFirst: jest.fn() },
      printLog: { create: jest.fn() },
    };
    const service = new PrintersService(
      prisma as never,
      disabledFlags as unknown as PrintingFeatureFlagsService,
    );

    expect(() => service.getPrintersByMerchant(7n)).toThrow(GoneException);
    expect(() => service.getDefaultPrinter(7n)).toThrow(GoneException);
    expect(() => service.getAutoPrintPrinters(7n)).toThrow(GoneException);
    await expect(service.createPrinter(7n, {} as never)).rejects.toBeInstanceOf(
      GoneException,
    );
    await expect(service.testPrint(7n, 11n)).rejects.toBeInstanceOf(
      GoneException,
    );
    await expect(service.printOrder(7n, 21n)).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(() =>
      service.createPrintLog({
        merchantId: 7n,
        status: 'PENDING',
        printedBy: 'SYSTEM',
      }),
    ).toThrow(GoneException);

    expect(prisma.printerSetting.create).not.toHaveBeenCalled();
    expect(prisma.printerSetting.findMany).not.toHaveBeenCalled();
    expect(prisma.printerSetting.findFirst).not.toHaveBeenCalled();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
    expect(prisma.printLog.create).not.toHaveBeenCalled();
    expect(socketConnect).not.toHaveBeenCalled();
    socketConnect.mockRestore();
  });
});
