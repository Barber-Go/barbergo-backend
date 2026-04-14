import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../generated/prisma/enums';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    if (dto.phone) {
      const phoneExists = await this.prisma.client.user.findUnique({
        where: { phone: dto.phone },
      });
      if (phoneExists) {
        throw new ConflictException('Phone number already in use');
      }
    }

    // Validate invite code before creating anything
    let targetBarbershop: { id: string } | null = null;
    if (dto.role === Role.BARBER_EMPLOYEE && dto.inviteCode) {
      const shop = await this.prisma.client.barbershopProfile.findUnique({
        where: { inviteCode: dto.inviteCode },
      });
      if (!shop) {
        throw new BadRequestException('Código de invitación inválido');
      }
      targetBarbershop = shop;
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.client.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        password: hashedPassword,
        role: dto.role as Role,
      },
    });

    let membershipStatus: string | undefined;

    if (dto.role === Role.BARBER || dto.role === Role.BARBER_INDEPENDENT) {
      await this.prisma.client.barberProfile.create({
        data: {
          userId: user.id,
          employmentType: 'INDEPENDENT',
          bio: dto.specialty || null,
        },
      });
    } else if (dto.role === Role.BARBER_EMPLOYEE) {
      const barberProfile = await this.prisma.client.barberProfile.create({
        data: {
          userId: user.id,
          employmentType: 'EMPLOYEE',
          barbershopId: targetBarbershop?.id ?? null,
        },
      });

      if (targetBarbershop) {
        // Valid invite code → create ACTIVE membership
        await this.prisma.client.barbershopStaffMembership.create({
          data: {
            barbershopId: targetBarbershop.id,
            barberProfileId: barberProfile.id,
            role: 'BARBER',
            isActive: true,
          },
        });
        membershipStatus = 'ACTIVE';
      } else {
        // No code → PENDING membership
        membershipStatus = 'PENDING';
      }
    } else if (dto.role === Role.BARBERSHOP_OWNER) {
      await this.prisma.client.barbershopProfile.create({
        data: {
          userId: user.id,
          name: dto.shopName || dto.name,
          address: dto.shopAddress || null,
          phone: dto.shopPhone || null,
          status: 'DRAFT',
        },
      });
    } else {
      // CLIENT
      await this.prisma.client.clientProfile.create({
        data: { userId: user.id },
      });
    }

    return {
      token: this.signToken(user),
      user: this.sanitize(user),
      membershipStatus,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { token: this.signToken(user), user: this.sanitize(user) };
  }

  async getMe(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return this.sanitize(user);
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    if (dto.email) {
      const existing = await this.prisma.client.user.findUnique({
        where: { email: dto.email },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Email already in use');
      }
    }

    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
    });

    return this.sanitize(user);
  }

  async getTaxStatus(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { taxModuleEnabled: true, taxModuleActivatedAt: true, barberProfile: { select: { rutTributario: true } } },
    });
    return {
      enabled: user?.taxModuleEnabled ?? false,
      activatedAt: user?.taxModuleActivatedAt?.toISOString() ?? null,
      hasCredentials: !!user?.barberProfile?.rutTributario,
    };
  }

  async toggleTaxModule(userId: string, enabled: boolean) {
    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        taxModuleEnabled: enabled,
        ...(enabled && { taxModuleActivatedAt: new Date() }),
      },
    });
    return { enabled: user.taxModuleEnabled, activatedAt: user.taxModuleActivatedAt?.toISOString() ?? null };
  }

  private signToken(user: { id: string; email: string; role: Role }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.sign(payload);
  }

  private sanitize(user: {
    id: string;
    email: string;
    phone: string | null;
    name: string;
    avatarUrl: string | null;
    role: Role;
    isVerified: boolean;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
    };
  }
}
