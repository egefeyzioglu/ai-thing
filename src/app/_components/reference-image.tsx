import clsx from "clsx";
import { Trash2 } from "lucide-react";
import Image from "next/image";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "src/components/ui/tooltip";

type ReferenceImageProps = {
  url: string;
  onSelect: () => void;
  onDelete: () => void;
  isSelected: boolean;
};

export default function ReferenceImage(props: ReferenceImageProps) {
  return (
    <div
      className={clsx(
        "group/ref relative p-0.75",
        props.isSelected ? "bg-blue-500" : "hover:bg-blue-300",
      )}
    >
      <Image
        width={100}
        height={100}
        alt="Reference Image"
        onClick={() => {
          props.onSelect();
        }}
        src={props.url}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="absolute top-1 right-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-neutral-950/80 text-red-400/60 opacity-0 transition-opacity group-hover/ref:opacity-100 hover:text-red-400 focus:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-400/40 focus-visible:outline-none"
              aria-label="Delete reference image"
            />
          }
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete();
          }}
        >
          <Trash2 className="size-3" />
        </TooltipTrigger>
        <TooltipContent>Delete reference image</TooltipContent>
      </Tooltip>
    </div>
  );
}
