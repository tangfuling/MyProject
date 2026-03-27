import type { PageResult } from '../../../common/network/ApiResponse';

export type UserProfile = {
  id: number;
  phone: string;
  balanceCent: number;
  freeQuotaCent: number;
  aiModel: string;
  articleCount: number;
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
