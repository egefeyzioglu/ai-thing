"use client";

// import { api, HydrateClient } from "src/trpc/server";
import { api } from "src/trpc/react"

import { Skeleton } from "src/components/ui/skeleton";
import { useState } from "react";

export const dynamic = "force-dynamic";

export default function Home() {
  // const {data, isLoading, error} = api.image.catOtter.useQuery({prompt: "This is a test prompt that should never make it to the server. If it does, do not generate an image and reply with a single '.' instead"});

  const [prompt, setPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState("");

  const {data, isLoading, error} = api.image.catOtter.useQuery(
    {prompt: submittedPrompt},
    {enabled: submittedPrompt.length > 0}
  );

  const {data: dataNanoBanana, isLoading: nanoBananaIsLoading, error: nanoBananaError} = api.image.catOtterNanoBanana.useQuery(
    {prompt: submittedPrompt},
    {enabled: submittedPrompt.length > 0}
  );
  // const [openai, nanoBanana] = await Promise.all([
  //   api.image.catOtter({prompt: "Generate an image of a cat using a laptop with stickers"}),
  //   api.image.catOtterNanoBanana(),
  // ]);

  const handleSubmit = ()=>{setSubmittedPrompt(prompt)}

  return (
    // <HydrateClient>
    <>
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 p-8 text-neutral-100">
        <div className="flex flex-col items-stretch justify-center gap-8 md:flex-row">
          {nanoBananaIsLoading ? <>
            <Skeleton className="h-[70vh] w-[40vh] rounded-lg shadow-2xl"/>
          </> : <>
            <figure className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dataNanoBanana?.dataUrl}
                alt={dataNanoBanana?.prompt.prompt}
                className="max-h-[70vh] w-auto rounded-lg shadow-2xl"
              />
              <figcaption className="text-xs uppercase tracking-wide text-neutral-400">
                Nano Banana (gemini-2.5-flash-image)
              </figcaption>
            </figure>
          </>}
          {isLoading ? <>
            <Skeleton className="h-[70vh] w-[40vh] rounded-lg shadow-2xl"/>
          </> : <>
            <figure className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data?.dataUrl}
                alt={data?.prompt.prompt}
                className="max-h-[70vh] w-auto rounded-lg shadow-2xl"
              />
              <figcaption className="text-xs uppercase tracking-wide text-neutral-400">
                GPT 5.4 Mini
              </figcaption>
            </figure>
          </>}
        </div>
        <p className="max-w-xl text-center text-sm text-neutral-400">
          {data?.prompt.prompt}
        </p>
        <input value={prompt} onChange={(e)=>{setPrompt(e.target.value)}} onKeyDown={(e)=>{if(e.key === "Enter" && e.ctrlKey) handleSubmit()}}/>
        <button onClick={handleSubmit}>Generate</button>
      </main>
    </>
    // </HydrateClient>
  );
}
