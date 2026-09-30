import * as React from "react"
import { cn } from "@/lib/utils"

/** Shared by Input, Textarea (own copy), and the native Select in Field.tsx so every text control has one look. Edge = line-strong (>=3:1). */
const inputStyles =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-body transition-[border-color,box-shadow] duration-[120ms] outline-none placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 selection:bg-primary selection:text-primary-foreground"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputStyles, "h-9 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground", className)}
      {...props}
    />
  )
}

export { Input, inputStyles }
