import axios, { type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse } from './ApiResponse';
import { HttpConfig } from './HttpConfig';
import { authInterceptor } from './interceptors/authInterceptor';
import { errorInterceptor } from './interceptors/errorInterceptor';

const HTTP_TIMEOUT = 10_000;

const instance = axios.create({
  baseURL: HttpConfig.getBaseUrl(),
  timeout: HTTP_TIMEOUT,
});

instance.interceptors.request.use((config) => {
  return authInterceptor(config) as InternalAxiosRequestConfig;
});

instance.interceptors.response.use(
  (response) => response,
  (error) => errorInterceptor(error)
);

async function unwrap<T>(request: Promise<AxiosResponse<ApiResponse<T>>>): Promise<T> {
  const response = await request;
  const payload = response.data;
  if (payload.code !== 0) {
    throw new Error(payload.message);
  }
  return payload.data;
}

const http = {
  get<T>(url: string, config?: AxiosRequestConfig) {
    return unwrap<T>(instance.get<ApiResponse<T>>(url, config));
  },
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return unwrap<T>(instance.post<ApiResponse<T>>(url, data, config));
  },
  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return unwrap<T>(instance.put<ApiResponse<T>>(url, data, config));
  },
  patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return unwrap<T>(instance.patch<ApiResponse<T>>(url, data, config));
  },
  delete<T>(url: string, config?: AxiosRequestConfig) {
    return unwrap<T>(instance.delete<ApiResponse<T>>(url, config));
  },
};

export default http;
