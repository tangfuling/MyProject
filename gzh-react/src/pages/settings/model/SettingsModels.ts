import type { PageResult } from '../../../common/network/ApiResponse';

export type UserProfile = {
  id: number;
  phone: string;
  balanceCent: number;
  freeQuotaCent: number;
  aiModel: string;
  articleCount: number;
  lastSyncAt?: string;
  createdAt?: string;
};

export type TokenLog = {
  id: number;
  bizType: string;
  bizId: string;
  aiModel: string;
  inputTokens: number;
  outputTokens: number;
  costCent: number;
  createdAt: string;
};

export type TokenLogPage = PageResult<TokenLog>;

export type PaymentCreateResult = {
  orderNo: string;
  payUrl: string;
};

export type PaymentOrder = {
  id: number;
  orderNo: string;
  amountCent: number;
  channel: string;
  status: string;
  alipayTradeNo?: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentOrderPage = PageResult<PaymentOrder>;
