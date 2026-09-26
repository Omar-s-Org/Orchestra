import { openDb } from "./db.js";
import { createApp } from "./http.js";
import { reset } from "./seed.js";

const db = openDb();
if (!(db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n) reset(db);
const port = Number(process.env.PORT ?? 8787);
createApp(db).listen(port, () => console.log(`Orchestra API http://localhost:${port}/api  ·  MCP http://localhost:${port}/mcp`));
