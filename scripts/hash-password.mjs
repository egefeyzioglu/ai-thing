#!/usr/bin/env node
/**
 * Hash a password into the format stored in `ai-thing_user.password_hash`.
 *
 * Usage:
 *   node scripts/hash-password.mjs '<password>'
 *
 * Then create a user by inserting a row, e.g. via psql:
 *
 *   INSERT INTO "ai-thing_user" (id, username, password_hash)
 *   VALUES (gen_random_uuid()::text, 'alice', 'scrypt$...$...');
 */
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64);
process.stdout.write(`scrypt$${salt.toString("hex")}$${hash.toString("hex")}\n`);
