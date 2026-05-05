import Image from 'next/image';

import { Card, CardTitle, CardDescription, CardContent, CardHeader } from 'src/components/ui/card';

import PatternBackground from './pattern-background';

import { IMAGE_STATUSES } from "src/server/db/schema";

function prettifyJson(input: string | unknown): string {
  try {
    const obj =
      typeof input === "string" ? JSON.parse(input) : input;
    return JSON.stringify(obj, null, 2);
  } catch {
    // fallback: return original input if parsing fails
    return typeof input === "string" ? input : String(input);
  }
}

function* cardRotation(seed_: number | string, rotationMin: number, rotationMax: number) {
  /**
   * https://gist.github.com/hyamamoto/fd435505d29ebfa3d9716fd2be8d42f0?permalink_comment_id=2694461#gistcomment-2694461
   */
  const hashCode = (s: string): number => {
    for (var i = 0, h = 0; i < s.length; i++)
      h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return h;
  }

  let seed = (typeof seed_ === "string") ? hashCode(seed_) : seed_;
  const a = 1103515245, c = 12345, m = 1 << 31;

  while (true) {
    seed = (a * seed + c) % m;
    let angle = seed % (rotationMax - rotationMin) + rotationMin;
    console.log(`seed is ${seed}, angle is ${angle}`);
    // yield "rotate-90";
    yield angle === 0 ?
      "rotate-none" :
      angle > 0 ?
        `rotate-${angle}` :
        `-rotate-${-angle}`;
  }
}

export type PromptGroupProps = {
  prompt: string;
  images: {
    url: string;
    modelSlug: string;
    status: (typeof IMAGE_STATUSES)[number];
    key: string;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
  referenceImages: {
    url?: string;
    id: string;
  }[];
};

export default function PromptGroup(props: PromptGroupProps) {
  const imagesByModel = Object.entries(
    props.images.reduce<Record<string, typeof props.images>>((acc, image) => {
      (acc[image.modelSlug] ??= []).push(image);
      return acc;
    }, {})
  ).map(([model, images]) => ({ model, images }));
  return (
    <div>
      <p>{props.prompt}</p>
      <div className="grid grid-cols-3 gap-6 m-4">
        {
          imagesByModel.map((model) => {
            console.log(`===== ${model.model} ====`);
            const rand = cardRotation(model.model, 0, 90)
            return (
              <Card key={model.model} className="bg-(--bg)">
                <CardHeader className="border-be z-100">{model.model}</CardHeader>
                <CardContent className='h-full min-h-40 relative'>
                  {model.images.map((image, idx) => {
                    return image.url === "<invalid_url>" ?
                      <div key={idx} className={`absolute w-8/10 aspect-16/9 rounded-md mx-auto border border-1 border-(--border) ${rand.next().value}`}>
                        <PatternBackground label="Generating..." />
                      </div> :
                      <img
                        key={image.key} src={image.url} width={100} height={100}
                        alt={`Generated image ${idx + 1} by ${model.model} for prompt "${props.prompt}"`}
                        className="w-8/10 rounded-md mx-auto"
                      />
                  })}
                </CardContent>
              </Card>
            )
          })
        }
      </div>
    </div>
  );
}