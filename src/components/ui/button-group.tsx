import { cn } from "src/lib/utils";

function ButtonGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "inline-flex items-stretch [&>*]:rounded-none [&>*:not(:first-child)]:border-l-0 [&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
