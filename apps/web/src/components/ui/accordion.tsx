"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"
import { Accordion as AccordionPrimitive } from "radix-ui"

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("mb-3 border-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "wood-grain flex min-h-12 flex-1 items-center justify-between gap-4 rounded-[10px] px-5 py-3 text-left font-ui text-lg font-bold text-driftwood shadow-[0_4px_0_var(--plank-dark)] [clip-path:polygon(1%_0,99%_0,100%_9%,99%_100%,0_100%,1%_92%)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor disabled:pointer-events-none disabled:opacity-50 data-[state=open]:shadow-[0_2px_0_var(--plank-dark)] [&[data-state=open]>svg]:rotate-90",
          className
        )}
        {...props}
      >
        {children}
        <ChevronRightIcon aria-hidden="true" className="pointer-events-none size-5 shrink-0 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden font-body text-sm text-driftwood data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("mx-2 rounded-b-lg bg-paper px-4 pt-4 pb-5 shadow-sm", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
