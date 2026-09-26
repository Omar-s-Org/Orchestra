import { describe, it, expect, afterAll } from "vitest";
import type { Server } from "node:http";
import { openDb } from "../src/db.js";
import { reset } from "../src/seed.js";
import { createApp } from "../src/http.js";
import { runChecks, formatResults } from "../src/check.js";

let server: Server;
afterAll(() => server?.close());

describe("frontend contract", () => {
  it("every endpoint matches docs/LOVABLE_PLAN.md §4 for every role", async () => {
    const db = openDb(":memory:"); reset(db);
    server = createApp(db).listen(0);
    await new Promise(r => server.once("listening", r));
    const results = await runChecks(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const failed = results.filter(r => !r.ok);
    expect(failed, formatResults(results)).toEqual([]);
    expect(results.length).toBeGreaterThan(30);
  });
});
