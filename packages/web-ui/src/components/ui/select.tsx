import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  value,
  onValueChange,
  options,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <SelectPrimitive.Root
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-line bg-card px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={6} className="z-50">
          <SelectPrimitive.Popup className="min-w-[var(--anchor-width)] rounded-xl border border-line bg-card p-1 shadow-lg">
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    "cursor-default rounded-lg px-2 py-2 text-sm outline-none data-[highlighted]:bg-paper",
                    option.disabled && "opacity-50",
                  )}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
