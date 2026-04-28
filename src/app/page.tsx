import { api, HydrateClient } from "src/trpc/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [openai, nanoBanana] = await Promise.all([
    api.image.catOtter(),
    api.image.catOtterNanoBanana(),
  ]);

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 p-8 text-neutral-100">
        <div className="flex flex-col items-stretch justify-center gap-8 md:flex-row">
          <figure className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={openai.dataUrl}
              alt={openai.prompt}
              className="max-h-[70vh] w-auto rounded-lg shadow-2xl"
            />
            <figcaption className="text-xs uppercase tracking-wide text-neutral-400">
              OpenAI Responses API
            </figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={nanoBanana.dataUrl}
              alt={nanoBanana.prompt}
              className="max-h-[70vh] w-auto rounded-lg shadow-2xl"
            />
            <figcaption className="text-xs uppercase tracking-wide text-neutral-400">
              Nano Banana (gemini-2.5-flash-image)
            </figcaption>
          </figure>
        </div>
        <p className="max-w-xl text-center text-sm text-neutral-400">
          {openai.prompt}
        </p>
      </main>
    </HydrateClient>
  );
}
