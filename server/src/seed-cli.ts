import { openDb } from "./db.js";
import { reset } from "./seed.js";
reset(openDb());
console.log("Seeded Northwind demo data.");
