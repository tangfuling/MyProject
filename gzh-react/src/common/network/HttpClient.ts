import axios, { type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse } from './ApiResponse';
import { ApiConfig } from './ApiConfig';
import { authInterceptor } from './interceptors/authInterceptor';
import { errorInterceptor } from './interceptors/errorInterceptor';

const instance = axios.create({
  baseURL: ApiConfig.baseUrl,
  timeout: ApiConfig.timeout,
});

type DebugRequestConfig = InternalAxiosRequestConfig & {
  _gzhReqStartAt?: number;
};

instance.interceptors.request.use((config) => {
  const next = authInterceptor(config) as DebugRequestConfig;
  next._gzhReqStartAt = Date.now();
  if (import.meta.env.DEV) {
    console.info('[gzh-react][http][request]', {
      method: (next.method || 'get').toUpperCase(),
      baseURL: next.baseURL,
      url: next.url,
      params: next.params,
    });
  }
  return next;
});

instance.interceptors.response.use(
  (response) => {
    if (import.meta.env.DEV) {
      const debugConfig = response.config as DebugRequestConfig;
      const costMs = debugConfig._gzhReqStartAt ? (Date.now() - debugConfig._gzhReqStartAt) : null;
      console.info('[gzh-react][http][response]', {
        method: (debugConfig.method || 'get').toUpperCase(),
        url: debugConfig.url,
        status: response.status,
        costMs,
        code: response.data?.code,
        message: response.data?.message,
      });
    }
    return response;
  },
  (error) => {
    if (import.meta.env.DEV) {
      const debugConfig = (error?.config || {}) as DebugRequestConfig;
      const costMs = debugConfig._gzhReqStartAt ? (Date.now() - debugConfig._gzhReqStartAt) : null;
      console.warn('[gzh-react][http][error]', {
        method: (debugConfig.method || 'get').toUpperCase(),
        url: debugConfig.url,
        status: error?.response?.status,
        costMs,
        message: error?.message,
      });
    }
    return errorInterceptor(error);
  }
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
