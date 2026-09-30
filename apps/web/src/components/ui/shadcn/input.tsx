import * as React from "react"
import { cn } from "@/lib/utils"

/** Shared by Input, Textarea (own copy), and the native Select in Field.tsx so every text control has one look. */
const inputStyles =
  "w-full min-w-0 rounded-lg border border-input bg-card px-3 text-[0.9375rem] shadow-card transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20 selection:bg-primary selection:text-primary-foreground"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputStyles, "h-11 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground", className)}
      {...props}
    />
  )
}

export { Input, inputStyles }
