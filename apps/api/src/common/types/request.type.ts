import { Request } from 'express';
import { AuthUser } from './auth-user.type';

export interface RequestWithContext extends Request {
  requestId: string;
  user?: AuthUser;
}
