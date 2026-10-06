import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border border-line bg-card px-2 py-0.5 text-xs text-muted", className)}
      {...props}
    />
  );
}

export { Badge };
