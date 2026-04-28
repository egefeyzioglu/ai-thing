import Link from "next/link";

import { api, HydrateClient } from "src/trpc/server";

export default async function Home() {
  return (
    <HydrateClient>
      <main></main>
    </HydrateClient>
  );
}
