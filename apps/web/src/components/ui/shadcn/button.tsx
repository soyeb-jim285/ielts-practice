import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-brand-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-card hover:brightness-95 focus-visible:ring-destructive/30",
        outline: "border border-border bg-card text-foreground shadow-card hover:border-input hover:bg-surface-2",
        secondary: "bg-surface-2 text-foreground hover:bg-hover",
        ghost: "text-foreground hover:bg-hover",
        link: "text-brand-text underline-offset-4 hover:underline active:scale-100",
      },
      // Touch targets: md/lg/icon are >= 44 px; sm keeps a 36 px look and gets a 44 px invisible hit area on phones (`hit`).
      size: {
        sm: "hit h-9 gap-1.5 px-3 text-sm [&_svg]:size-4",
        default: "h-11 gap-2 px-4 text-sm [&_svg]:size-4",
        lg: "h-13 gap-2 px-6 text-base [&_svg]:size-5",
        icon: "size-11 [&_svg]:size-5",
        "icon-sm": "hit size-9 [&_svg]:size-4",
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
