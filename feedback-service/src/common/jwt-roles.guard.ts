import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class JwtRolesGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService, private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Falta el token de autenticación");
    }
    const token = authHeader.slice("Bearer ".length);
    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || "dev_secret_change_me",
      });
      req.user = { id: payload.sub, role: payload.role };
    } catch {
      throw new UnauthorizedException("Token inválido o expirado");
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length && !requiredRoles.includes(req.user.role)) {
      throw new ForbiddenException(`Se requiere rol: ${requiredRoles.join(" o ")}`);
    }
    return true;
  }
}
