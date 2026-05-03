"use client";

import { Label } from "src/components/ui/label";
import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "src/components/ui/collapsible";
import { Checkbox } from "src/components/ui/checkbox";

import { useEffect, useState } from "react";
import Image from "next/image"

import { ChevronUp, ChevronDown} from "lucide-react"
import clsx from "clsx";

export const dynamic = "force-dynamic";

type ReferenceImageProps = {
  src: string;
  alt: string;
  isSelected: boolean;
  width: number;
  height: number;
  setSelected: () => void;
  onDelete: () => void;
};

function ReferenceImage(props: ReferenceImageProps) {
  return (
    <button onClick={props.setSelected} className={clsx("group border-1 rounded-md overflow-clip relative")}>
      <div className={clsx("size-4 border-2 border-(--muted-foreground) absolute top-1.5 left-1.5 rounded-full cursor-pointer",
        props.isSelected ? "opacity-100 border-blue-500" : "opacity-30 transition-opacity group-hover:opacity-100")}>
        <div className={clsx("size-2.5 absolute top-0.25 left-0.25 rounded-full",
          props.isSelected ? "bg-blue-500 opacity-100" :
            "bg-(--muted-foreground) opacity-30 transition-opacity group-hover:opacity-60"
        )} />
      </div>

      <div
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete?.();
        }}
        className="size-4 absolute top-1.5 right-1.5 rounded-full border-2 border-(--muted-foreground) opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center cursor-pointer"
      >
        <div className="relative size-2.5">
          <div className="absolute inset-0 rotate-45 bg-(--muted-foreground) h-[2px] m-auto" />
          <div className="absolute inset-0 -rotate-45 bg-(--muted-foreground) h-[2px] m-auto" />
        </div>
      </div>

      <Image
        src={props.src} alt={props.alt}
        width={props.width} height={props.height}
        className="m-auto w-full" />
    </button>
  );
}
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const ret = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return ret;
  };
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const imageSizes_ = [...Array(20)].map((_, i) => {
  const rand = mulberry32(i);
  const a = Math.floor(rand() * 100 + 20);
  const b = Math.floor(rand() * 100 + a);
  const [w, h] = rand() < 0.5 ? [a, b] : [b, a];
  const id = `${Math.floor(100000000 * rand())}`;
  return { w: w, h: h, id: id };
});

export default function Home() {
  const [imageSizes, setImageSizes] = useState(imageSizes_);
  const [referenceImagesOpen, setReferenceImagesOpen] = useState(false);
  const [selectedReferenceImages, setSelectedReferenceImages] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [resolution, setResolution] = useState("1024");
  const [isMacOS, setIsMacOS] = useState<boolean | null>(null);

  const toggleSelectedModel = (slug : string) => {
    if(selectedModels.includes(slug)){
      setSelectedModels(selectedModels.filter((i) => i !== slug));
    } else {
      setSelectedModels([...selectedModels, slug]);
    }
  }

  useEffect(
    () => {setIsMacOS(navigator?.userAgent.toLowerCase().includes("mac"))},
    []);
  return (
    <main className="w-full grow flex flex-row text-gray-200">
      <aside className="w-1/5 h-screen border border-x border-(--border)">
        <div className="border-y border-(--border) flex flex-row gap-4 items-center p-5">
          <div className="w-8 h-8 bg-blue-400 rounded-md"></div>
          <div>
            <h1 className="text-lg font-heading font-bold">AI Thing</h1>
            <p className="text-xs text-(--muted-foreground)">All your models, in one place</p>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-3 overflow-y-scroll">
          <Field>
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Prompt</FieldLabel>
            <Textarea id="prompt" placeholder="What do you want to create?.." />
            {/* TODO: Make this less cursed */}
            <span className={clsx("text-xs text-(--muted-foreground) mx-0", isMacOS === null ? "opacity-0" : "opacity-80")}>
              Press {isMacOS ? "⌘" : "Ctrl"} + Enter to submit
            </span>
          </Field>
          <Collapsible open={referenceImagesOpen} onOpenChange={setReferenceImagesOpen}>
            <CollapsibleTrigger className="w-full flex flex-row justify-between cursor-pointer">
              {/* TODO: Idk if I'm supposed to do this, but I'm guessing not (font size won't match otherwise) */}
              <FieldLabel className="uppercase text-xxs text-(--muted-foreground) cursor-pointer">
                Reference Images
              </FieldLabel>
              {referenceImagesOpen ? <ChevronUp color="var(--muted-foreground)" /> : <ChevronDown color="var(--muted-foreground)" />}
            </CollapsibleTrigger>
            {
            selectedReferenceImages.length > 0 ?
            // TODO: This should ideally look better and not push down the sidebar as it comes in
            <span className="text-xs text-(--muted-foreground) mx-0">
              {`(${selectedReferenceImages.length} image${selectedReferenceImages.length > 1 ? 's' : ''} selected)`}
            </span> :
            ""
            }
            <CollapsibleContent className="max-h-80 overflow-scroll">
              <div className="grid grid-cols-3 gap-2 my-2 p-2">
                {imageSizes.map((e) => {
                  const { w, h, id } = e;
                  return <ReferenceImage
                    key={id} src={`https://picsum.photos/seed/${id}/${w}/${h}`} alt="Sample reference image"
                    width={w ?? 100} height={h ?? 100}
                    isSelected={selectedReferenceImages.some(e => `${id}` === e)}
                    setSelected={() => {
                      const isSelected = selectedReferenceImages.some(e => `${id}` === e);
                      if (isSelected)
                        setSelectedReferenceImages(selectedReferenceImages.filter(e => `${id}` !== e))
                      else
                        setSelectedReferenceImages([...selectedReferenceImages, `${id}`])
                    }}
                    onDelete={
                      () => {
                        setImageSizes(imageSizes.filter((v) => v.id !== id));
                        setSelectedReferenceImages(selectedReferenceImages.filter((i)=>(i !== id)));
                      }
                    }
                    />
                })}
              </div>
              {/* TODO: Add reference image button */}
            </CollapsibleContent>
          </Collapsible>
          <Field>
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Models</FieldLabel>
            {
              [
              {slug: "gpt-5-4-mini", name: "GPT 5.4 Mini", by: "OpenAI"},
              {slug: "gemini-2-5-flash", name: "Gemini 2.5 Flash", by: "Google"}
              ].map(({slug, name, by}) => (
                <button key={slug}
                  className={clsx("flex flex-row items-center gap-4 px-4 py-2 border border-1 text-(--foreground) rounded-md cursor-pointer",
                    selectedModels.includes(slug) ? "bg-gray-800 border-blue-500" : "hover:bg-gray-900"
                  )}
                  onClick={(e)=>{
                    e.preventDefault();
                    toggleSelectedModel(slug);
                  }}
                >
                  <Checkbox id={`model-select-${slug}`} accentColor="blue-500"
                    checked={selectedModels.includes(slug)} onCheckedChange={()=>{toggleSelectedModel(slug)}}/>
                  <Label htmlFor={`model-select-${slug}`} className="flex-col items-start cursor-pointer">
                    {name}<br/>
                    <span className="text-(--muted-foreground)">{by}</span>
                  </Label>
                </button>
              ))
            }
          </Field>
          <Field>
            <FieldLabel className="uppercase text-xxs text-(--muted-foreground)">Resolution</FieldLabel>
            <div className="flex flex-row gap-2">
              {
                ["512", "1024", "2048"].map((resolutionOption) => (
                  <button key={resolutionOption}
                    className={clsx("flex flex-row items-center px-2 py-1 border border-1 text-sm rounded-md cursor-pointer",
                      resolution === resolutionOption ? "bg-blue-500 text-(--foreground)" : "hover:bg-gray-900 text-(--muted-foreground) "
                    )}
                    onClick={(e)=>{
                      e.preventDefault();
                      setResolution(resolutionOption)
                    }}
                  >
                    {resolutionOption}
                  </button>
                ))
              }
            </div>
          </Field>
        </div>
      </aside>
      <div></div>
    </main>
  );
}
