import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async controller so a rejected promise reaches the error handler.
 * (Express 5 forwards sync throws already; this covers async rejections.)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
