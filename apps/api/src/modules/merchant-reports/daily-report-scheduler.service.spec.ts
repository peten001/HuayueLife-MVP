import { DailyReportSchedulerService } from './daily-report-scheduler.service';

describe('DailyReportSchedulerService', () => {
  const original = process.env.API_SHADOW_DIAGNOSTIC_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.API_SHADOW_DIAGNOSTIC_MODE;
    else process.env.API_SHADOW_DIAGNOSTIC_MODE = original;
  });

  it('does not query settings or send reports in shadow diagnostic mode', async () => {
    process.env.API_SHADOW_DIAGNOSTIC_MODE = 'true';
    const prisma = { merchantReportSetting: { findMany: jest.fn() } };
    const reports = { sendDailyReportForMerchant: jest.fn() };
    const service = new DailyReportSchedulerService(prisma as never, reports as never);

    await service.scanDailyReports();

    expect(prisma.merchantReportSetting.findMany).not.toHaveBeenCalled();
    expect(reports.sendDailyReportForMerchant).not.toHaveBeenCalled();
  });
});
