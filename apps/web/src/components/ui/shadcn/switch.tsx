import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "hit peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-[200ms]  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-6 data-[size=default]:w-10 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white shadow-card ring-0 transition-transform duration-200 ease-(--ease-out-expo) group-data-[size=default]/switch:size-[1.125rem] group-data-[size=sm]/switch:size-2.5 data-[state=checked]:translate-x-[1.1875rem] data-[state=unchecked]:translate-x-[0.1875rem]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
