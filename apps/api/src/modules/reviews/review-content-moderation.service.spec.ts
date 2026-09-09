import {
  ReviewModerationCheckStatus,
  ReviewModerationCheckType,
  ReviewStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { ReviewContentModerationService } from './review-content-moderation.service';

function config(values: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

function prisma() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ openid: 'openid-8' }),
    },
    merchantReviewModerationCheck: {
      create: jest.fn().mockResolvedValue({ id: 1n }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 1n }),
    },
    merchantReview: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 91n }),
    },
  };
}

function auth() {
  return {
    getWechatAccessToken: jest.fn().mockResolvedValue('access-token'),
  };
}

describe('ReviewContentModerationService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publishes safe text only after both local and WeChat text checks pass', async () => {
    const database = prisma();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      errcode: 0,
      errmsg: 'ok',
      result: { suggest: 'pass', label: 100 },
      trace_id: 'trace-text-safe',
    }), { status: 200 }));
    const service = new ReviewContentModerationService(
      database as never,
      config({
        WECHAT_CONTENT_SECURITY_ENABLED: 'true',
        WECHAT_APP_ID: 'app-id',
        WECHAT_APP_SECRET: 'app-secret',
      }) as never,
      auth() as never,
    );

    const result = await service.assessText(8n, '味道不错，服务也很周到。');

    expect(result.status).toBe(ReviewStatus.PUBLISHED);
    expect(result.checks).toEqual([
      expect.objectContaining({
        type: ReviewModerationCheckType.LOCAL_TEXT,
        status: ReviewModerationCheckStatus.PASS,
      }),
      expect.objectContaining({
        type: ReviewModerationCheckType.WECHAT_TEXT,
        status: ReviewModerationCheckStatus.PASS,
        providerTraceId: 'trace-text-safe',
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/wxa/msg_sec_check?access_token='),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"scene":2'),
      }),
    );
  });

  it.each([
    ['辱骂', '这家店真是傻逼', 'PROFANITY'],
    ['手机号', '联系我 0912 345 678', 'CONTACT_INFORMATION'],
    ['社交账号', '加我微信 abcde123', 'CONTACT_INFORMATION'],
  ])('sends %s content to manual review without publishing', async (_label, content, code) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      errcode: 0,
      result: { suggest: 'pass', label: 100 },
      trace_id: `trace-${code}`,
    }), { status: 200 }));
    const service = new ReviewContentModerationService(
      prisma() as never,
      config({
        WECHAT_CONTENT_SECURITY_ENABLED: 'true',
        WECHAT_APP_ID: 'app-id',
        WECHAT_APP_SECRET: 'app-secret',
      }) as never,
      auth() as never,
    );

    const result = await service.assessText(8n, content);

    expect(result.status).toBe(ReviewStatus.PENDING_REVIEW);
    expect(result.checks[0]).toEqual(expect.objectContaining({
      status: ReviewModerationCheckStatus.REVIEW,
      reasonCodes: expect.arrayContaining([code]),
    }));
  });

  it('fails closed when the WeChat text service is disabled or unavailable', async () => {
    const service = new ReviewContentModerationService(
      prisma() as never,
      config({ WECHAT_CONTENT_SECURITY_ENABLED: 'false' }) as never,
      auth() as never,
    );

    const result = await service.assessText(8n, '正常评价内容');

    expect(result.status).toBe(ReviewStatus.PENDING_REVIEW);
    expect(result.checks).toContainEqual(expect.objectContaining({
      type: ReviewModerationCheckType.WECHAT_TEXT,
      status: ReviewModerationCheckStatus.ERROR,
      errorCode: 'WECHAT_CHECK_DISABLED',
    }));
  });

  it('submits public review images to WeChat and stores a pending trace', async () => {
    const database = prisma();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      errcode: 0,
      trace_id: 'trace-image-501',
    }), { status: 200 }));
    const service = new ReviewContentModerationService(
      database as never,
      config({
        WECHAT_CONTENT_SECURITY_ENABLED: 'true',
        WECHAT_APP_ID: 'app-id',
        WECHAT_APP_SECRET: 'app-secret',
        REVIEW_MEDIA_PUBLIC_BASE_URL: 'https://api.example.com',
      }) as never,
      auth() as never,
    );

    await service.submitImageChecks(91n, 'openid-8', [
      { id: 501n, imageUrl: '/uploads/reviews/review-a.webp' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/wxa/media_check_async?access_token='),
      expect.objectContaining({
        body: expect.stringContaining('https://api.example.com/uploads/reviews/review-a.webp'),
      }),
    );
    expect(database.merchantReviewModerationCheck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewId: 91n,
        imageId: 501n,
        status: ReviewModerationCheckStatus.PENDING,
        providerTraceId: 'trace-image-501',
      }),
    });
  });

  it('applies an image callback and publishes only when every check has passed', async () => {
    const database = prisma();
    database.merchantReviewModerationCheck.findUnique.mockResolvedValue({
      id: 700n,
      reviewId: 91n,
      type: ReviewModerationCheckType.WECHAT_IMAGE,
    });
    database.merchantReview.findUnique.mockResolvedValue({
      status: ReviewStatus.PENDING_REVIEW,
      moderationChecks: [
        { status: ReviewModerationCheckStatus.PASS },
        { status: ReviewModerationCheckStatus.PASS },
      ],
    });
    const service = new ReviewContentModerationService(
      database as never,
      config({ WECHAT_APP_ID: 'app-id' }) as never,
      auth() as never,
    );

    await expect(service.applyWechatMediaCallback({
      appid: 'app-id',
      trace_id: 'trace-image-501',
      result: { suggest: 'pass', label: 100 },
    })).resolves.toBe(true);

    expect(database.merchantReviewModerationCheck.update).toHaveBeenCalledWith({
      where: { id: 700n },
      data: expect.objectContaining({ status: ReviewModerationCheckStatus.PASS }),
    });
    expect(database.merchantReview.update).toHaveBeenCalledWith({
      where: { id: 91n },
      data: { status: ReviewStatus.PUBLISHED },
    });
  });

  it('moves a published review back to pending when an image callback is risky', async () => {
    const database = prisma();
    database.merchantReviewModerationCheck.findUnique.mockResolvedValue({
      id: 700n,
      reviewId: 91n,
      type: ReviewModerationCheckType.WECHAT_IMAGE,
    });
    database.merchantReview.findUnique.mockResolvedValue({
      status: ReviewStatus.PUBLISHED,
      moderationChecks: [
        { status: ReviewModerationCheckStatus.PASS },
        { status: ReviewModerationCheckStatus.RISKY },
      ],
    });
    const service = new ReviewContentModerationService(
      database as never,
      config({ WECHAT_APP_ID: 'app-id' }) as never,
      auth() as never,
    );

    await expect(service.applyWechatMediaCallback({
      appid: 'app-id',
      trace_id: 'trace-image-501',
      result: { suggest: 'risky', label: 20002 },
    })).resolves.toBe(true);

    expect(database.merchantReviewModerationCheck.update).toHaveBeenCalledWith({
      where: { id: 700n },
      data: expect.objectContaining({ status: ReviewModerationCheckStatus.RISKY }),
    });
    expect(database.merchantReview.update).toHaveBeenCalledWith({
      where: { id: 91n },
      data: { status: ReviewStatus.PENDING_REVIEW },
    });
  });

  it('verifies the configured plaintext WeChat callback signature', () => {
    const service = new ReviewContentModerationService(
      prisma() as never,
      config({ WECHAT_CONTENT_SECURITY_CALLBACK_TOKEN: 'callback-token' }) as never,
      auth() as never,
    );
    const timestamp = '1788960000';
    const nonce = 'nonce-value';
    const signature = createHash('sha1')
      .update(['callback-token', timestamp, nonce].sort().join(''))
      .digest('hex');

    expect(service.verifyCallbackSignature(signature, timestamp, nonce)).toBe(true);
    expect(service.verifyCallbackSignature('invalid', timestamp, nonce)).toBe(false);
  });
});
