#!/usr/bin/env bash

set -euo pipefail

echo "Fetching password from Bitwarden"
SUPABASE_PASSWORD=$(bw list items --search "ai thing supabase password" | jq -r .[0].login.password)
echo "$ pnpm drizzle-kit push"
DATABASE_URL="postgresql://postgres:$SUPABASE_PASSWORD@db.ngyrocznnilsefsxnxvt.supabase.co:6543/postgres" DIRECT_URL="postgresql://postgres:$SUPABASE_PASSWORD@db.ngyrocznnilsefsxnxvt.supabase.co:5432/postgres" pnpm drizzle-kit push
