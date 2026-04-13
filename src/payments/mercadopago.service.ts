import { Injectable } from '@nestjs/common';
import { MercadoPagoConfig, Preference } from 'mercadopago';

@Injectable()
export class MercadoPagoService {
  private client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || '',
  });

  async createPreference(bookingId: string, amount: number, description: string, backUrl: string) {
    const preference = new Preference(this.client);
    const result = await preference.create({
      body: {
        items: [{ id: bookingId, title: description, quantity: 1, unit_price: amount, currency_id: 'CLP' }],
        back_urls: { success: backUrl+'/success', failure: backUrl+'/failure', pending: backUrl+'/pending' },
        auto_return: 'approved',
        external_reference: bookingId,
      },
    });
    return { preferenceId: result.id, initPoint: result.init_point };
  }
}
