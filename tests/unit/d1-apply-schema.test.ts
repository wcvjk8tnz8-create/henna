import { describe, expect, it } from "vitest";
import { D1_SCHEMA_SQL, splitSqlStatements, applyD1Schema } from "@/db/d1-schema";
import type { D1Binding } from "@/db/runtime";

/**
 * Schema application, checked against a binding that behaves like D1.
 *
 * The regression that motivated this: `applyD1Schema` ended with
 * `prepare("... VALUES ('0000_init', ?)").run()` and no bound argument. D1
 * rejects that with "Wrong number of parameter bindings for SQL query", which
 * surfaced as a red "Database unavailable" banner on every page — the schema
 * never applied, so nothing worked, and the reason was invisible.
 *
 * sql.js cannot catch this: it tolerates a `?` with no binding. Only a binding
 * that refuses unbound placeholders does, which is what the fake below is.
 */

/** Rejects any statement carrying a placeholder, as D1 does without a bind. */
function strictBinding(): { binding: D1Binding; statements: string[] } {
  const statements: string[] = [];
  const ok = { run: async () => ({ success: true }), all: async () => ({ results: [] }) };

  const binding: D1Binding = {
    prepare(sql: string) {
      statements.push(sql);
      if (sql.includes("?")) {
        return {
          run: async () => {
            throw new Error("D1_ERROR: Wrong number of parameter bindings for SQL query.");
          },
          all: async () => {
            throw new Error("D1_ERROR: Wrong number of parameter bindings for SQL query.");
          },
        };
      }
      return ok;
    },
    batch: async () => [],
  };
  return { binding, statements };
}

describe("applyD1Schema", () => {
  it("sends no statement with an unbound placeholder", async () => {
    const { binding, statements } = strictBinding();
    await expect(applyD1Schema(binding)).resolves.toBeUndefined();
    const offenders = statements.filter((sql) => sql.includes("?"));
    expect(offenders).toEqual([]);
  });

  it("never leaves a '?' in the schema SQL itself", () => {
    // Guards the other direction: a `?` written into a CREATE statement would
    // fail the same way, and is easy to introduce by accident.
    for (const statement of splitSqlStatements(D1_SCHEMA_SQL)) {
      expect(statement.includes("?")).toBe(false);
    }
  });

  it("records the migration so a warm isolate skips the work", async () => {
    const statements: string[] = [];
    let inserted = 0;
    const binding: D1Binding = {
      prepare(sql: string) {
        statements.push(sql);
        if (sql.includes("_schema_migrations") && sql.includes("INSERT")) inserted += 1;
        return {
          run: async () => ({ success: true }),
          // Second call: the row now exists, so it must return early.
          all: async () => ({ results: [{ name: "0000_init" }] }),
        };
      },
      batch: async () => {
        throw new Error("must not re-apply when the migration row exists");
      },
    };
    await applyD1Schema(binding);
    expect(inserted).toBe(0);
  });
});
