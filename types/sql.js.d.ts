/**
 * Minimal ambient types for `sql.js`.
 *
 * The package ships no declarations, and `tests/unit/d1-integration.test.ts`
 * uses only a handful of its methods. Declaring just those keeps the build's
 * type check happy without adding a dependency that would drift from the
 * version actually installed.
 */
declare module "sql.js" {
  export interface SqlJsDatabase {
    run(sql: string): void;
    prepare(sql: string): SqlJsStatement;
    close(): void;
  }

  export interface SqlJsStatement {
    bind(values?: Array<string | number | Uint8Array | null>): boolean;
    step(): boolean;
    get(): Array<unknown>;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  /** The engine also exposes the constructor as a named type. */
  export type Database = SqlJsDatabase;

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  export default function initSqlJs(options?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
