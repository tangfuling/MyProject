import http from '../../../common/network/HttpClient';
import type { PaymentCreateResult, PaymentOrderPage, TokenLogPage, UserProfile } from '../model/SettingsModels';

const SettingsApi = {
  profile() {
    return http.get<UserProfile>('/user/profile');
  },
  updateModel(model: string) {
    return http.put<void>('/user/ai-model', { model });
  },
  tokenLogs(page: number, size: number) {
    return http.get<TokenLogPage>('/user/token-logs', { params: { page, size } });
  },
  paymentOrders(page: number, size: number) {
    return http.get<PaymentOrderPage>('/payment/orders', { params: { page, size } });
  },
  createPayment(amountCent: number) {
    return http.post<PaymentCreateResult>('/payment/create', { amountCent, subject: '公众号助手充值' });
  },
};

export default SettingsApi;
