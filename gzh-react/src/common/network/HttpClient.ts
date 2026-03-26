import axios from 'axios';
import type { ApiResponse } from './ApiResponse';
import { ApiConfig } from './ApiConfig';
import { authInterceptor } from './interceptors/authInterceptor';
import { errorInterceptor } from './interceptors/errorInterceptor';

const http = axios.create({
  baseURL: ApiConfig.baseUrl,
  timeout: ApiConfig.timeout,
});

http.interceptors.request.use((config) => authInterceptor(config));
http.interceptors.response.use(
  (response) => {
    const payload = response.data as ApiResponse<unknown>;
    if (payload.code !== 0) {
      return Promise.reject(new Error(payload.message));
    }
    return payload.data;
  },
  (error) => errorInterceptor(error)
);

export default http;
