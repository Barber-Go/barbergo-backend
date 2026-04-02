import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreateWebpayPaymentDto } from './dto/create-payment.dto';
import { ConfirmWebpayPaymentDto } from './dto/confirm-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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

  @Post('webpay/confirm')
  confirmWebpay(@Body() dto: ConfirmWebpayPaymentDto) {
    return this.paymentsService.confirmTransaction(dto.token_ws);
  }

  @Get('booking/:bookingId')
  @UseGuards(JwtAuthGuard)
  getPaymentByBooking(@Param('bookingId') bookingId: string) {
    return this.paymentsService.getPaymentByBooking(bookingId);
  }
}
