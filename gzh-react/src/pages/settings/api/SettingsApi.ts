import http from '../../../common/network/HttpClient';
import type {
  PaymentCreateResult,
  PaymentOrderPage,
  TokenLogPage,
  UpdateUserProfilePayload,
  UserProfile,
} from '../model/SettingsModels';

const SettingsApi = {
  profile() {
    return http.get<UserProfile>('/user/profile');
  },
  updateProfile(payload: UpdateUserProfilePayload) {
    return http.put<void>('/user/profile', payload);
  },
  uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return http.post<string>('/user/avatar', formData);
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
    return http.post<PaymentCreateResult>('/payment/create', {
      amountCent,
      subject: 'Content Ops Assistant Recharge',
    });
  },
};

export default SettingsApi;
