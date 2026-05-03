"use client";

import { Field, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "src/components/ui/collapsible";

import { useState } from "react";
import Image from "next/image"

import { ChevronUp, ChevronDown, CheckIcon } from "lucide-react"
import clsx from "clsx";

export const dynamic = "force-dynamic";

type ReferenceImageProps = {
  src: string;
  alt: string;
  isSelected: boolean;
  width: number;
  height: number;
  setSelected: ()=>void;
};

function ReferenceImage(props: ReferenceImageProps) {
  return(
    <button onClick={props.setSelected} className={clsx("group border-1 rounded-md overflow-clip relative")}>
      <div className={clsx("size-4 border-2 border-(--muted-foreground) absolute top-1.5 left-1.5 rounded-full",
        props.isSelected ? "opacity-100 border-blue-500" : "opacity-30 transition-opacity group-hover:opacity-100")}>
          <div className={clsx("size-2.5 absolute top-0.25 left-0.25 rounded-full",
            props.isSelected ? "bg-blue-500 opacity-100" :
              "bg-(--muted-foreground) opacity-30 transition-opacity group-hover:opacity-60"
          )} />
      </div>
      <Image
        src={props.src} alt={props.alt}
        width={props.width} height={props.height}
        className="m-auto w-full"/>
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

const imageSizes = [...Array(20)].map((_, i) => {
  const rand = mulberry32(i);
  const a = Math.floor(rand() * 100 + 20);
  const b = Math.floor(rand() * 100 + a);
  const [w, h] = Math.random() < 0.5 ? [a, b] : [b, a];
  const id = `${Math.floor(100000000 * rand())}`;
  return {w: w, h: h, id: id};
});

export default function Home() {
  const [referenceImagesOpen, setReferenceImagesOpen] = useState(false);
  const [ selectedReferenceImages, setSelectedReferenceImages ] = useState<string[]>([]);
  return (
    <main className="w-full grow flex flex-row text-gray-200">
      <aside className="w-1/4 h-screen border border-x border-(--border)">
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
          </Field>
          <Collapsible open={referenceImagesOpen} onOpenChange={setReferenceImagesOpen}>
            <CollapsibleTrigger className="w-full flex flex-row justify-between cursor-pointer">
              {/* TODO: Idk if I'm supposed to do this, but I'm guessing not (font size won't match otherwise) */}
              <FieldLabel className="uppercase text-xxs text-(--muted-foreground) cursor-pointer">Reference Images</FieldLabel>
              { referenceImagesOpen ? <ChevronDown/> : <ChevronUp/> }
            </CollapsibleTrigger>
            <CollapsibleContent className="max-h-80 overflow-scroll">
              <div className="grid grid-cols-3 gap-2 my-2 p-2">
                {imageSizes.map((e) => {
                  const {w, h, id} = e;
                  return <ReferenceImage
                    key={id} src={`https://picsum.photos/seed/${id}/${w}/${h}`} alt="Sample reference image"
                    width={w ?? 100} height={h ?? 100}
                    isSelected={selectedReferenceImages.some(e => `${id}` === e)}
                    setSelected={()=>{
                      const isSelected = selectedReferenceImages.some(e => `${id}` === e);
                      if(isSelected)
                        setSelectedReferenceImages(selectedReferenceImages.filter(e => `${id}` !== e))
                      else
                        setSelectedReferenceImages([...selectedReferenceImages,`${id}`])
                    }}/>
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </aside>
      <div></div>
    </main>
  );
}
