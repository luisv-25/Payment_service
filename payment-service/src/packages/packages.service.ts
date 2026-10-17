import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Package } from "./entities/package.entity";
import { CreatePackageDto } from "./dto/create-package.dto";
import { TransactionsService } from "../transactions/transactions.service";

interface Requester {
  id: string;
  role: string;
}

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package) private readonly packagesRepo: Repository<Package>,
    private readonly transactionsService: TransactionsService,
  ) {}

  // Permiso de estudiante: comprar un paquete de horas. El studentId sale
  // del token, nunca del body (mismo criterio que BookingsService.create).
  async purchase(studentId: string, dto: CreatePackageDto) {
    const pkg = await this.packagesRepo.save(
      this.packagesRepo.create({
        student_id: studentId,
        hours_purchased: dto.hoursPurchased,
        hours_remaining: dto.hoursPurchased,
      }),
    );
    await this.transactionsService.chargePackagePurchase(studentId, pkg, dto.amount);
    return pkg;
  }

  async findOne(id: string) {
    const pkg = await this.packagesRepo.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException(`Paquete ${id} no encontrado`);
    return pkg;
  }

  findAll(studentId: string | undefined, requester: Requester) {
    const where: any = {};
    if (requester.role === "student") {
      where.student_id = requester.id;
    } else if (studentId) {
      where.student_id = studentId;
    }
    return this.packagesRepo.find({ where, order: { purchased_at: "DESC" } });
  }

  async assertOwnerOrAdmin(id: string, requester: Requester) {
    const pkg = await this.findOne(id);
    if (requester.role !== "admin" && pkg.student_id !== requester.id) {
      throw new ForbiddenException("No puedes ver el paquete de otro estudiante");
    }
    return pkg;
  }
}
