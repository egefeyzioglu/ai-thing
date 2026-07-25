#!/usr/bin/env bash
#
# Apply pending Drizzle migrations to the Supabase prod database.
#
# Reads pending SQL files from drizzle/ and applies any whose hashes are
# not yet present in drizzle.__drizzle_migrations. Safe to re-run; a no-op
# if everything is already applied.
#
# Run after `pnpm db:generate` + code review of the new SQL.

set -euo pipefail

OP_ACCOUNT="${1:-${OP_ACCOUNT:-my.1password.com}}"

echo "Fetching password from 1Password account: $OP_ACCOUNT"
SUPABASE_PASSWORD=$(op item get "ai thing supabase password" --fields password --reveal --account "$OP_ACCOUNT")

read -r -p "About to run 'drizzle-kit migrate' against PROD. Continue? [y/N] "
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

echo "$ pnpm drizzle-kit migrate"
DATABASE_URL="postgresql://postgres:$SUPABASE_PASSWORD@db.ngyrocznnilsefsxnxvt.supabase.co:6543/postgres" \
DIRECT_URL="postgresql://postgres:$SUPABASE_PASSWORD@db.ngyrocznnilsefsxnxvt.supabase.co:5432/postgres" \
pnpm drizzle-kit migrate

echo