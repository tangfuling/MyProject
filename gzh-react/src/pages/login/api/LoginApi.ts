import http from '../../../common/network/HttpClient';
import type { LoginResult } from '../model/LoginModels';

const LoginApi = {
  sendCode(phone: string) {
    return http.post<void>('/auth/send-code', { phone });
  },
  login(phone: string, code: string) {
    return http.post<LoginResult>('/auth/login', { phone, code });
  },
};

export default LoginApi;
