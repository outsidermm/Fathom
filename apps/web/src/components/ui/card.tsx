import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  variant = "paper",
  ...props
}: React.ComponentProps<"div"> & { variant?: "paper" | "plank" | "sea" }) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(
        "relative flex flex-col gap-6 border-0 py-6 shadow-[0_10px_24px_rgb(80_49_32_/_0.18)]",
        variant === "paper" &&
          "rounded-[4px] bg-paper text-driftwood before:absolute before:left-1/2 before:top-2 before:size-2 before:-translate-x-1/2 before:rounded-full before:bg-coral before:shadow-[0_1px_2px_rgb(80_49_32_/_0.35)]",
        variant === "plank" &&
          "wood-grain rounded-[10px] text-driftwood shadow-[0_5px_0_var(--plank-dark)]",
        variant === "sea" &&
          "rounded-2xl bg-water text-ink",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-ui text-lg leading-tight font-bold text-harbor", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-6", className)} {...props} />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  CardFooter,
};
