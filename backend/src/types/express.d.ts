import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Populated by the `requireAuth` middleware. */
      user?: {
        id: string;
        name: string;
        email: string;
        role: Role;
      };
    }
  }
}

export {};
