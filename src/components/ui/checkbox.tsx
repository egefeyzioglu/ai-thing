"use client"

import type { CSSProperties } from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "src/lib/utils"

type CheckboxProps = CheckboxPrimitive.Root.Props & {
  accentColor?: string
}

type CheckboxStyle = CSSProperties & {
  "--checkbox-accent"?: string
}

function withAccentStyle(
  style: CheckboxPrimitive.Root.Props["style"],
  accentStyle?: string
): CheckboxPrimitive.Root.Props["style"] {
  if (!accentStyle) {
    return style
  }

  if (typeof style === "function") {
    return (state) => {
      const nextStyle: CheckboxStyle = {
        ...style(state),
        "--checkbox-accent": accentStyle,
      }

      return nextStyle
    }
  }

  const nextStyle: CheckboxStyle = {
    ...style,
    "--checkbox-accent": accentStyle,
  }

  return nextStyle
}

function resolveAccentColor(accentColor?: string) {
  if (!accentColor) {
    return undefined
  }

  if (accentColor.startsWith("[") && accentColor.endsWith("]")) {
    const value = accentColor.slice(1, -1)
    return value || undefined
  }

  return `var(--color-${accentColor})`
}

function Checkbox({ accentColor, className, style, ...props }: CheckboxProps) {
  const accentStyle = resolveAccentColor(accentColor)

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      style={withAccentStyle(style, accentStyle)}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        accentStyle &&
          "aria-invalid:aria-checked:border-[var(--checkbox-accent)] data-checked:border-[var(--checkbox-accent)] data-checked:bg-[var(--checkbox-accent)] dark:data-checked:bg-[var(--checkbox-accent)]",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
