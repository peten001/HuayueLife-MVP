import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { IdParamDto } from "../../common/dto/id-param.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PlatformAdminGuard } from "../../common/guards/platform-admin.guard";
import { AuthUser } from "../../common/types/auth-user.type";
import { PlatformDirectoryQueryDto } from "./dto/platform-directory-query.dto";
import {
  MerchantDraft,
  PlatformWorkbenchService,
} from "./platform-workbench.service";
class NewDraftDto {
  @IsOptional() @IsString() @MaxLength(120) nameZh?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
}
@Controller("platform/workbench")
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformWorkbenchController {
  constructor(private readonly service: PlatformWorkbenchService) {}
  @Get("directory") directory(@Query() q: PlatformDirectoryQueryDto) {
    return this.service.directory(q);
  }
  @Get("directory-export")
  exportDirectory(@Query() q: PlatformDirectoryQueryDto) {
    return this.service.exportDirectory(q);
  }
  @Get("merchants/:id/quick")
  quick(@Param() p: IdParamDto) {
    return this.service.quick(BigInt(p.id));
  }
  @Post("selection") selection(
    @Body() q: PlatformDirectoryQueryDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.selection(q, u.username ?? u.sub);
  }
  @Post("bulk") bulk(
    @Body() b: { ids?: string[]; token?: string; action?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.bulk(b, u.username ?? u.sub);
  }
  @Get("search") search(@Query("q") q: string) {
    return this.service.search(q);
  }
  @Get("queue") queue() {
    return this.service.queue();
  }
  @Get("health") health() {
    return this.service.health();
  }
  @Post("merchant-drafts") create(@Body() dto: NewDraftDto) {
    return this.service.createDraft(dto.nameZh, dto.city);
  }
  @Get("merchants/:id/draft") draft(@Param() p: IdParamDto) {
    return this.service.draft(BigInt(p.id));
  }
  @Put("merchants/:id/draft") save(
    @Param() p: IdParamDto,
    @Body() body: MerchantDraft,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.saveDraft(BigInt(p.id), body, u.username ?? u.sub);
  }
  @Post("merchants/:id/publish") publish(
    @Param() p: IdParamDto,
    @Body() body: MerchantDraft,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.saveDraft(
      BigInt(p.id),
      body,
      u.username ?? u.sub,
      true,
    );
  }
  @Get("trash") trash() {
    return this.service.trash();
  }
  @Post("trash/:id/restore") restore(@Param() p: IdParamDto) {
    return this.service.restore(BigInt(p.id));
  }
  @Get("tags/:id/impact") impact(@Param() p: IdParamDto) {
    return this.service.tagImpact(BigInt(p.id));
  }
}
