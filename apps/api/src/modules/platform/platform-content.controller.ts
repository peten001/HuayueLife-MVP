import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PlatformAdminGuard } from "../../common/guards/platform-admin.guard";
import { AuthUser } from "../../common/types/auth-user.type";
import {
  ContentDraft,
  PlatformContentService,
} from "./platform-content.service";
@Controller("platform/content")
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformContentController {
  constructor(private readonly service: PlatformContentService) {}
  @Get("draft") get() {
    return this.service.get();
  }
  @Put("draft") save(@Body() b: ContentDraft, @CurrentUser() u: AuthUser) {
    return this.service.save(b, u.username ?? u.sub);
  }
  @Post("publish") publish(
    @Body() b: ContentDraft & { previewToken?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.save(b, u.username ?? u.sub, true);
  }
  @Post("preview") preview(
    @Body() b: { draft: ContentDraft; city: string; at: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.preview(b.draft, b.city, b.at, u.username ?? u.sub);
  }
}
