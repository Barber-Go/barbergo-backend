import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoPagoConfig, Preference } from 'mercadopago';

/**
 * Enmascara el access token para logging.
 * Muestra prefijo hasta el primer '-' + últimos 4 chars.
 * NUNCA loggear el token completo.
 */
function maskToken(token: string): string {
  if (token.length === 0) return '(empty)';
  const dashIdx = token.indexOf('-');
  const prefix = dashIdx >= 0 ? token.slice(0, dashIdx) : token.slice(0, 4);
  const last4 = token.slice(-4);
  return `${prefix}-...${last4}`;
}

@Injectable()
export class MercadoPagoService implements OnModuleInit {
  private readonly logger = new Logger(MercadoPagoService.name);
  private client!: MercadoPagoConfig;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const mpEnv = this.config.get<string>('MP_ENV') ?? '';
    const token = this.config.get<string>('MP_ACCESS_TOKEN') ?? '';

    // Validación defensiva redundante (env.validation ya corrió en bootstrap,
    // pero el service debe ser robusto si alguien lo instancia en tests o
    // si la validación cambia).
    if (mpEnv !== 'sandbox' && mpEnv !== 'production') {
      const msg = `[MercadoPagoService] invalid MP_ENV "${mpEnv}" — expected "sandbox" or "production"`;
      this.logger.error(msg);
      throw new InternalServerErrorException(msg);
    }

    if (token.length === 0) {
      const msg = '[MercadoPagoService] MP_ACCESS_TOKEN is missing or empty';
      this.logger.error(msg);
      throw new InternalServerErrorException(msg);
    }

    if (mpEnv === 'production' && !token.startsWith('APP_USR-')) {
      const msg = `[MercadoPagoService] MP_ENV=production but MP_ACCESS_TOKEN does not start with 'APP_USR-' (got mask ${maskToken(token)})`;
      this.logger.error(msg);
      throw new InternalServerErrorException(msg);
    }

    if (mpEnv === 'sandbox' && !token.startsWith('TEST-')) {
      const msg = `[MercadoPagoService] MP_ENV=sandbox but MP_ACCESS_TOKEN does not start with 'TEST-' (got mask ${maskToken(token)})`;
      this.logger.error(msg);
      throw new InternalServerErrorException(msg);
    }

    this.client = new MercadoPagoConfig({ accessToken: token });

    this.logger.log(
      `[MercadoPagoService] initialized — mode=${mpEnv}, token=${maskToken(token)}`,
    );
  }

  async createPreference(
    bookingId: string,
    amount: number,
    description: string,
    backUrl: string,
  ) {
    const preference = new Preference(this.client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: bookingId,
            title: description,
            quantity: 1,
            unit_price: amount,
            currency_id: 'CLP',
          },
        ],
        back_urls: {
          success: backUrl + '/success',
          failure: backUrl + '/failure',
          pending: backUrl + '/pending',
        },
        auto_return: 'approved',
        external_reference: bookingId,
      },
    });
    return { preferenceId: result.id, initPoint: result.init_point };
  }
}
