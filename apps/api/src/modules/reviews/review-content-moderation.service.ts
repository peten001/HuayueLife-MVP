import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ReviewModerationCheckStatus,
  ReviewModerationCheckType,
  ReviewStatus,
} from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';

const WECHAT_TEXT_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const WECHAT_MEDIA_CHECK_URL = 'https://api.weixin.qq.com/wxa/media_check_async';
const WECHAT_COMMENT_SCENE = 2;
const REQUEST_TIMEOUT_MS = 6000;

const COMPACT_PROFANITY_TERMS = [
  '操你妈',
  '草你妈',
  '日你妈',
  '妈卖批',
  '傻逼',
  '煞笔',
  '狗日的',
  '王八蛋',
] as const;

const WORD_PROFANITY_PATTERNS = [
  /\bf+u+c+k+(?:er|ing|ed)?\b/iu,
  /\bsh+i+t+(?:ty)?\b/iu,
  /\bb+i+t+c+h+\b/iu,
  /\bc+u+n+t+\b/iu,
  /\bđ[iị]+t\s*m[eẹ]+\b/iu,
  /\bđ[uụ]+\s*m[aá]+\b/iu,
  /\bv[aã]+i\s*l[oồ]+n\b/iu,
  /\bc[aặ]+c\b/iu,
] as const;

type CheckInput = {
  type: ReviewModerationCheckType;
  status: ReviewModerationCheckStatus;
  reasonCodes?: string[];
  providerLabel?: number;
  providerTraceId?: string;
  errorCode?: string;
};

type WechatSecurityResponse = {
  errcode?: unknown;
  errmsg?: unknown;
  trace_id?: unknown;
  result?: {
    suggest?: unknown;
    label?: unknown;
  };
};

export type ReviewTextAssessment = {
  openid: string | null;
  status: ReviewStatus;
  checks: CheckInput[];
};

@Injectable()
export class ReviewContentModerationService {
  private readonly logger = new Logger(ReviewContentModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async assessText(userId: bigint, content: string | null): Promise<ReviewTextAssessment> {
    const localCheck = this.inspectLocal(content);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { openid: true },
    });
    const openid = user?.openid?.trim() || null;
    const wechatCheck = content
      ? await this.checkWechatText(content, openid)
      : null;
    const checks = [localCheck, ...(wechatCheck ? [wechatCheck] : [])];
    const status = checks.every((check) => check.status === ReviewModerationCheckStatus.PASS)
      ? ReviewStatus.PUBLISHED
      : ReviewStatus.PENDING_REVIEW;
    return { openid, status, checks };
  }

  async submitImageChecks(
    reviewId: bigint,
    openid: string | null,
    images: Array<{ id: bigint; imageUrl: string }>,
  ) {
    await Promise.all(images.map(async (image) => {
      try {
        const check = await this.checkWechatImage(image.imageUrl, openid);
        await this.prisma.merchantReviewModerationCheck.create({
          data: {
            reviewId,
            imageId: image.id,
            ...this.toPrismaCheck(check),
          },
        });
      } catch (error) {
        this.logger.warn(
          `Review image moderation could not be recorded reviewId=${reviewId.toString()} error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
        );
      }
    }));
  }

  verifyCallbackSignature(signature?: string, timestamp?: string, nonce?: string) {
    const token = this.config
      .get<string>('WECHAT_CONTENT_SECURITY_CALLBACK_TOKEN')
      ?.trim();
    if (!token || !signature || !timestamp || !nonce) return false;
    const expected = createHash('sha1')
      .update([token, timestamp, nonce].sort().join(''))
      .digest('hex');
    return safeEqual(signature, expected);
  }

  async applyWechatMediaCallback(body: Record<string, unknown>) {
    const traceId = stringValue(
      body.trace_id
      ?? body.traceId
      ?? body.TraceId
      ?? body.TraceID,
    );
    if (!traceId) return false;

    const configuredAppId = this.config.get<string>('WECHAT_APP_ID')?.trim();
    const callbackAppId = stringValue(body.appid ?? body.AppId ?? body.AppID);
    if (configuredAppId && callbackAppId && configuredAppId !== callbackAppId) {
      this.logger.warn('Ignored WeChat media security callback with mismatched AppID');
      return false;
    }

    const rawResult = objectValue(body.result ?? body.Result);
    const suggest = stringValue(rawResult?.suggest ?? rawResult?.Suggest).toLowerCase();
    const status = this.wechatSuggestStatus(suggest);
    const label = numberValue(rawResult?.label ?? rawResult?.Label);
    const existing = await this.prisma.merchantReviewModerationCheck.findUnique({
      where: { providerTraceId: traceId },
      select: { id: true, reviewId: true, type: true },
    });
    if (!existing || existing.type !== ReviewModerationCheckType.WECHAT_IMAGE) {
      this.logger.warn('Ignored WeChat media security callback with unknown trace ID');
      return false;
    }

    await this.prisma.merchantReviewModerationCheck.update({
      where: { id: existing.id },
      data: {
        status,
        providerLabel: label,
        reasonCodes:
          status === ReviewModerationCheckStatus.PASS
            ? Prisma.DbNull
            : [`WECHAT_LABEL_${label ?? 'UNKNOWN'}`],
        errorCode:
          status === ReviewModerationCheckStatus.ERROR
            ? 'WECHAT_CALLBACK_RESULT_INVALID'
            : null,
      },
    });
    await this.reconcileReviewStatus(existing.reviewId);
    return true;
  }

  toPrismaCheck(check: CheckInput) {
    return {
      type: check.type,
      status: check.status,
      reasonCodes: check.reasonCodes?.length ? check.reasonCodes : undefined,
      providerLabel: check.providerLabel,
      providerTraceId: check.providerTraceId,
      errorCode: check.errorCode,
    } satisfies Prisma.MerchantReviewModerationCheckUncheckedCreateWithoutReviewInput;
  }

  private inspectLocal(content: string | null): CheckInput {
    const normalized = content?.normalize('NFKC').toLocaleLowerCase().trim() ?? '';
    const compact = normalized.replace(/[\s\p{P}\p{S}_]+/gu, '');
    const reasonCodes = new Set<string>();

    if (
      COMPACT_PROFANITY_TERMS.some((term) => compact.includes(term))
      || WORD_PROFANITY_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      reasonCodes.add('PROFANITY');
    }
    if (containsContactInformation(normalized, compact)) {
      reasonCodes.add('CONTACT_INFORMATION');
    }

    return {
      type: ReviewModerationCheckType.LOCAL_TEXT,
      status: reasonCodes.size
        ? ReviewModerationCheckStatus.REVIEW
        : ReviewModerationCheckStatus.PASS,
      reasonCodes: [...reasonCodes],
    };
  }

  private async checkWechatText(
    content: string,
    openid: string | null,
  ): Promise<CheckInput> {
    if (!this.wechatContentSecurityEnabled()) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_TEXT, 'WECHAT_CHECK_DISABLED');
    }
    if (!openid) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_TEXT, 'WECHAT_OPENID_MISSING');
    }
    const response = await this.callWechatSecurityApi(WECHAT_TEXT_CHECK_URL, {
      content,
      version: 2,
      scene: WECHAT_COMMENT_SCENE,
      openid,
    });
    return this.normalizeWechatResult(ReviewModerationCheckType.WECHAT_TEXT, response);
  }

  private async checkWechatImage(
    imageUrl: string,
    openid: string | null,
  ): Promise<CheckInput> {
    if (!this.wechatContentSecurityEnabled()) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_IMAGE, 'WECHAT_CHECK_DISABLED');
    }
    if (!openid) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_IMAGE, 'WECHAT_OPENID_MISSING');
    }
    const mediaUrl = this.publicReviewImageUrl(imageUrl);
    if (!mediaUrl) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_IMAGE, 'PUBLIC_MEDIA_URL_UNAVAILABLE');
    }
    const response = await this.callWechatSecurityApi(WECHAT_MEDIA_CHECK_URL, {
      media_url: mediaUrl,
      media_type: 2,
      version: 2,
      scene: WECHAT_COMMENT_SCENE,
      openid,
    });
    if (response.errorCode) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_IMAGE, response.errorCode);
    }
    const traceId = stringValue(response.payload?.trace_id);
    if (!traceId) {
      return this.errorCheck(ReviewModerationCheckType.WECHAT_IMAGE, 'WECHAT_TRACE_ID_MISSING');
    }
    return {
      type: ReviewModerationCheckType.WECHAT_IMAGE,
      status: ReviewModerationCheckStatus.PENDING,
      providerTraceId: traceId,
    };
  }

  private async callWechatSecurityApi(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<{ payload?: WechatSecurityResponse; errorCode?: string }> {
    const appId = this.config.get<string>('WECHAT_APP_ID')?.trim();
    const appSecret = this.config.get<string>('WECHAT_APP_SECRET')?.trim();
    if (!appId || !appSecret) return { errorCode: 'WECHAT_CREDENTIALS_MISSING' };

    try {
      const accessToken = await this.auth.getWechatAccessToken(appId, appSecret);
      const response = await fetch(
        `${endpoint}?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      const payload = (await response.json()) as WechatSecurityResponse;
      const errcode = numberValue(payload.errcode);
      if (!response.ok || (errcode !== null && errcode !== 0)) {
        return { errorCode: `WECHAT_${errcode ?? response.status}` };
      }
      return { payload };
    } catch (error) {
      this.logger.warn(
        `WeChat content security check failed error=${error instanceof Error ? error.name : 'UNKNOWN'}`,
      );
      return { errorCode: 'WECHAT_REQUEST_FAILED' };
    }
  }

  private normalizeWechatResult(
    type: ReviewModerationCheckType,
    response: { payload?: WechatSecurityResponse; errorCode?: string },
  ): CheckInput {
    if (response.errorCode) return this.errorCheck(type, response.errorCode);
    const result = response.payload?.result;
    const suggest = stringValue(result?.suggest).toLowerCase();
    const status = this.wechatSuggestStatus(suggest);
    const label = numberValue(result?.label);
    const traceId = stringValue(response.payload?.trace_id);
    return {
      type,
      status,
      providerLabel: label ?? undefined,
      providerTraceId: traceId || undefined,
      reasonCodes:
        status === ReviewModerationCheckStatus.PASS
          ? []
          : [`WECHAT_LABEL_${label ?? 'UNKNOWN'}`],
      errorCode:
        status === ReviewModerationCheckStatus.ERROR
          ? 'WECHAT_RESULT_INVALID'
          : undefined,
    };
  }

  private wechatSuggestStatus(value: string) {
    if (value === 'pass') return ReviewModerationCheckStatus.PASS;
    if (value === 'review') return ReviewModerationCheckStatus.REVIEW;
    if (value === 'risky' || value === 'block') return ReviewModerationCheckStatus.RISKY;
    return ReviewModerationCheckStatus.ERROR;
  }

  private errorCheck(type: ReviewModerationCheckType, errorCode: string): CheckInput {
    return {
      type,
      status: ReviewModerationCheckStatus.ERROR,
      errorCode,
    };
  }

  private wechatContentSecurityEnabled() {
    const configured = this.config
      .get<string>('WECHAT_CONTENT_SECURITY_ENABLED')
      ?.trim()
      .toLowerCase();
    if (configured === 'true') return true;
    if (configured === 'false') return false;
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private publicReviewImageUrl(imageUrl: string) {
    const baseUrl = this.config
      .get<string>('REVIEW_MEDIA_PUBLIC_BASE_URL')
      ?.trim();
    if (!baseUrl || !/^https:\/\//i.test(baseUrl)) return null;
    try {
      return new URL(imageUrl, `${baseUrl.replace(/\/+$/, '')}/`).toString();
    } catch {
      return null;
    }
  }

  private async reconcileReviewStatus(reviewId: bigint) {
    const review = await this.prisma.merchantReview.findUnique({
      where: { id: reviewId },
      select: {
        status: true,
        moderationChecks: { select: { status: true } },
      },
    });
    if (!review || review.status === ReviewStatus.HIDDEN) return;
    const allPassed = review.moderationChecks.length > 0
      && review.moderationChecks.every(
        (check) => check.status === ReviewModerationCheckStatus.PASS,
      );
    const nextStatus = allPassed
      ? ReviewStatus.PUBLISHED
      : ReviewStatus.PENDING_REVIEW;
    if (nextStatus !== review.status) {
      await this.prisma.merchantReview.update({
        where: { id: reviewId },
        data: { status: nextStatus },
      });
    }
  }
}

function containsContactInformation(normalized: string, compact: string) {
  const email = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu;
  const url = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|vn|cn)\b/iu;
  const vietnamPhone = /(?:\+?84|0)[\s.-]?(?:3|5|7|8|9)(?:[\s.-]?\d){8}\b/u;
  const chinaPhone = /(?:\+?86[\s.-]?)?1[3-9](?:[\s.-]?\d){9}\b/u;
  const labeledHandle = /(?:微信|微訊|wechat|v信|vx|zalo|telegram|whatsapp|line|qq)\s*(?:号|id|：|:)?\s*[a-z0-9][a-z0-9._-]{4,}/iu;
  const solicitation = /(?:加我微信|扫码联系|掃碼聯繫|私聊我|私信我|联系我|聯繫我|nhắn\s*(?:tin)?\s*(?:cho)?\s*mình)/iu;
  return email.test(normalized)
    || url.test(normalized)
    || vietnamPhone.test(normalized)
    || chinaPhone.test(normalized)
    || labeledHandle.test(normalized)
    || solicitation.test(normalized)
    || /(?:加我|联系我|私聊)[a-z0-9]{5,}/iu.test(compact);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}
