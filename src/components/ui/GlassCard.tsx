import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tint = "neutral" | "win" | "loss" | "be";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  strong?: boolean;
  tint?: Tint;
};

const TINT_CLASS: Record<Tint, string> = {
  neutral: "",
  win: "glass-tint-win",
  loss: "glass-tint-loss",
  be: "glass-tint-be",
};

export function GlassCard({
  children,
  className,
  strong,
  tint = "neutral",
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      className={cn(
        strong ? "glass-strong" : "glass",
        TINT_CLASS[tint],
        "rounded-2.5xl shadow-glass",
        className,
      )}
    >
      {children}
    </div>
  );
}
