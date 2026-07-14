export interface ApiResponse<T> {
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
  requestId?: string;
  timestamp?: string;
  path?: string;
}

export type ApiActivityDetail =
  | { status: 'success'; occurredAt: string }
  | {
      status: 'failure';
      occurredAt: string;
      online: boolean;
      errorCode: string;
      statusCode?: number;
    };
