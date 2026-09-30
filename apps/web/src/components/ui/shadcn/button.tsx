import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/** Filled buttons carry a 1px top highlight (var(--highlight)); no glow, no gradient. Press = 1px down. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-[120ms] ease-(--ease-out-expo) select-none  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-loading:cursor-progress data-loading:opacity-100! [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-(--highlight) hover:bg-brand-hover",
        secondary: "bg-(--surface-2) text-foreground hover:bg-[color-mix(in_oklab,var(--surface-2),var(--ink)_6%)]",
        outline: "border border-input bg-card text-foreground hover:bg-hover",
        ghost: "text-foreground hover:bg-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-(--highlight) hover:bg-destructive/90 focus-visible:outline-destructive",
        link: "text-brand-text underline-offset-4 hover:underline active:translate-y-0",
      },
      // Product density: 36 px default (32 sm, 40 lg) at every width. Phones get a 44 px invisible hit area (`hit`), not a fatter button.
      size: {
        sm: "hit h-8 gap-1.5 px-2.5 text-caption [&_svg]:size-3.5",
        default: "hit h-9 gap-1.5 px-3.5 text-sm [&_svg]:size-4",
        lg: "hit h-10 gap-2 px-4 text-sm [&_svg]:size-4",
        icon: "hit size-9 [&_svg]:size-4",
        "icon-sm": "hit size-8 [&_svg]:size-4",
        inline: "h-auto gap-1 p-0 text-sm [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
