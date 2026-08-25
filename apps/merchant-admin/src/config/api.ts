const DEFAULT_API_BASE_URL = import.meta.env.PROD
  ? '/api/v1'
  : 'http://localhost:3001/api/v1';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
