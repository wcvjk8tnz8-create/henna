export async function qAll<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> {
  const stmt = db.prepare(sql);
  const res = args.length ? await stmt.bind(...args).all<T>() : await stmt.all<T>();
  return (res.results ?? []) as T[];
}

export async function qOne<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T | null> {
  const stmt = db.prepare(sql);
  const res = args.length
    ? await stmt.bind(...args).first<T>()
    : await stmt.first<T>();
  return res ?? null;
}

export async function exec(db: D1Database, sql: string, ...args: unknown[]): Promise<void> {
  const stmt = db.prepare(sql);
  if (args.length) await stmt.bind(...args).run();
  else await stmt.run();
}
