export type LoginUser = {
  id: number;
  phone: string;
  balance: number;
  freeQuota: number;
  aiModel: string;
};

export type LoginResult = {
  token: string;
  user: LoginUser;
};
