import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
};

export function Pill({ active, children, className, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "px-3.5 py-1.5 rounded-full text-[12px] font-medium leading-none transition-colors whitespace-nowrap",
        active
          ? "bg-ink text-white shadow-card"
          : "text-ink hover:bg-white/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
