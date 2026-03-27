export type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

export type PageResult<T> = {
  page: number;
  size: number;
  total: number;
  records: T[];
};
