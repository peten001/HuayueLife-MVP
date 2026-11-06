import { PlatformAnalyticsService } from './platform-analytics.service';
const order=(status:string,amount:bigint,day='2026-11-05T04:00:00Z')=>({id:1n,merchantId:1n,orderType:'PICKUP',status,totalAmountVnd:amount,createdAt:new Date(day),merchant:{id:1n,nameZh:'门店',city:'北宁',district:null,status:'ACTIVE'}});
describe('Platform analytics completed amount and prior period',()=>{
 it('counts cancellations, separates amounts and keeps large integer sums exact',async()=>{
  const prisma={order:{findMany:jest.fn().mockResolvedValueOnce([order('COMPLETED',100n,'2026-11-04T04:00:00Z')]).mockResolvedValueOnce([order('COMPLETED',900719925474099310n),order('PENDING_ACCEPTANCE',70n),order('CANCELLED',90n)])}};
  const result=await new PlatformAnalyticsService(prisma as never).getAnalytics({dateFrom:'2026-11-05',dateTo:'2026-11-05'});
  expect(result.summary).toMatchObject({orderCount:3,orderAmount:'900719925474099310',completedOrderCount:1,pendingOrderCount:1,canceledOrderCount:1,activeOrderAmount:'70',canceledOrderAmount:'90',averageOrderAmount:'900719925474099310'});
  expect(result.trend).toEqual([{date:'2026-11-05',orderCount:3,orderAmount:'900719925474099310'}]);
  expect(result.previous).toMatchObject({dateFrom:'2026-11-04',dateTo:'2026-11-04',orderAmount:'100'});
  expect(result.merchantRankingByAmount[0].orderAmount).toBe('900719925474099310');
  for(const [arg] of prisma.order.findMany.mock.calls)expect(JSON.stringify(arg.where)).toContain('voidedAt');
 });
 it('aligns an equal preceding period using Vietnam midnight boundaries',async()=>{const findMany=jest.fn().mockResolvedValue([]);const service=new PlatformAnalyticsService({order:{findMany}} as never);await service.getAnalytics({dateFrom:'2026-11-01',dateTo:'2026-11-07',city:'北宁',merchantId:'7'});expect(findMany.mock.calls[0][0].where).toMatchObject({merchantId:7n,merchant:{city:'北宁'},createdAt:{gte:new Date('2026-10-24T17:00:00Z'),lt:new Date('2026-10-31T17:00:00Z')}});});
 it('rejects reversed or excessively large date ranges',async()=>{const findMany=jest.fn();const service=new PlatformAnalyticsService({order:{findMany}} as never);await expect(service.getAnalytics({dateFrom:'2026-11-07',dateTo:'2026-11-01'})).rejects.toThrow('1 至 366');expect(findMany).not.toHaveBeenCalled();});
});

describe('Platform hourly comparison',()=>{
 it('uses Vietnam hours and keeps future intervals missing rather than zero',async()=>{jest.useFakeTimers();try{jest.setSystemTime(new Date('2026-11-05T05:30:00Z'));const findMany=jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([order('COMPLETED',125000n,'2026-11-05T04:15:00Z')]);const result=await new PlatformAnalyticsService({order:{findMany}} as never).getAnalytics({dateFrom:'2026-11-05',dateTo:'2026-11-05'});expect(result.chartTrend).toHaveLength(24);expect(result.chartTrend?.[11]).toMatchObject({orderCount:1,orderAmount:'125000'});expect(result.chartTrend?.[10]).toMatchObject({orderCount:0,orderAmount:'0'});expect(result.chartTrend?.[13]).toMatchObject({orderCount:null,orderAmount:null});expect(result.previous.chartTrend?.[13]).toMatchObject({orderCount:0,orderAmount:'0'});}finally{jest.useRealTimers();}});
});
