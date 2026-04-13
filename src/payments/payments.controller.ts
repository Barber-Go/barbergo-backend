import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { CreateWebpayPaymentDto } from './dto/create-payment.dto';
import { CreateMpPreferenceDto } from './dto/create-mp-preference.dto';
import { MercadoPagoService } from './mercadopago.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/payments')
export class PaymentsController {
  private readonly frontendUrl: string;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly mercadoPagoService: MercadoPagoService,
    private readonly config: ConfigService,
  ) {
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:8081';
  }

  @Post('webpay/create')
  @UseGuards(JwtAuthGuard)
  createWebpay(@Request() req: any, @Body() dto: CreateWebpayPaymentDto) {
    return this.paymentsService.createTransaction(
      req.user.id,
      dto.bookingId,
      dto.amount,
      dto.returnUrl,
    );
  }

  // Transbank POST callback after payment
  @Post('webpay/confirm')
  async confirmWebpayPost(
    @Body() body: { token_ws?: string; TBK_TOKEN?: string; TBK_ORDEN_COMPRA?: string },
    @Res() res: Response,
  ) {
    // User aborted at Transbank
    if (body.TBK_TOKEN && !body.token_ws) {
      await this.paymentsService.abortTransaction(body.TBK_TOKEN);
      return res.redirect(`${this.frontendUrl}/(client)?payment=aborted`);
    }

    if (!body.token_ws) {
      return res.redirect(`${this.frontendUrl}/(client)?payment=error`);
    }

    const result = await this.paymentsService.confirmTransaction(body.token_ws);
    const status = result.status === 'APPROVED' ? 'success' : 'rejected';
    return res.redirect(
      `${this.frontendUrl}/(client)?payment=${status}&bookingId=${result.bookingId}`,
    );
  }

  // Transbank GET callback (timeout/cancel fallback)
  @Get('webpay/confirm')
  async confirmWebpayGet(
    @Query('token_ws') tokenWs: string,
    @Query('TBK_TOKEN') tbkToken: string,
    @Res() res: Response,
  ) {
    if (tbkToken && !tokenWs) {
      await this.paymentsService.abortTransaction(tbkToken);
      return res.redirect(`${this.frontendUrl}/(client)?payment=aborted`);
    }

    if (!tokenWs) {
      return res.redirect(`${this.frontendUrl}/(client)?payment=error`);
    }

    const result = await this.paymentsService.confirmTransaction(tokenWs);
    const status = result.status === 'APPROVED' ? 'success' : 'rejected';
    return res.redirect(
      `${this.frontendUrl}/(client)?payment=${status}&bookingId=${result.bookingId}`,
    );
  }

  @Post('mp/create-preference')
  @UseGuards(JwtAuthGuard)
  createMpPreference(@Body() dto: CreateMpPreferenceDto) {
    return this.mercadoPagoService.createPreference(
      dto.bookingId,
      dto.amount,
      dto.description,
      dto.backUrl,
    );
  }

  @Get('booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  getPaymentByBooking(@Param('bookingId') bookingId: string) {
    return this.paymentsService.getPaymentByBooking(bookingId);
  }
}
