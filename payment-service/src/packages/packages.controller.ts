import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { PackagesService } from "./packages.service";
import { CreatePackageDto } from "./dto/create-package.dto";
import { JwtRolesGuard } from "../common/jwt-roles.guard";
import { Roles } from "../common/roles.decorator";

@Controller("packages")
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Post()
  @UseGuards(JwtRolesGuard)
  @Roles("student")
  purchase(@Body() dto: CreatePackageDto, @Req() req: any) {
    return this.packagesService.purchase(req.user.id, dto);
  }

  @Get()
  @UseGuards(JwtRolesGuard)
  findAll(@Query("studentId") studentId: string | undefined, @Req() req: any) {
    return this.packagesService.findAll(studentId, req.user);
  }

  @Get(":id")
  @UseGuards(JwtRolesGuard)
  findOne(@Param("id") id: string, @Req() req: any) {
    return this.packagesService.assertOwnerOrAdmin(id, req.user);
  }
}
