import { Hono } from 'hono';

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code?: number };

export function ok<T>(data: T): ApiOk<T> {
  return { ok: true, data };
}

export function fail(error: string, code = 400): ApiErr {
  return { ok: false, error, code };
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** 统一响应与错误出口 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindErrorHandler(app: Hono<any>) {
  app.onError((err, c) => {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : 'internal error';
    return c.json(fail(message, status), status as 400);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json(fail('not found', 404), 404);
    }
    return c.notFound();
  });
}
