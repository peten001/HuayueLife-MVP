export interface ApiSuccessResponse<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string | string[];
  data: null;
  requestId: string;
  timestamp: string;
  path: string;
}
