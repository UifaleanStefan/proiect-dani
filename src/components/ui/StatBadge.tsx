import { cn } from "../../lib/cn";

type Variant =
  | "win"
  | "loss"
  | "be"
  | "buy"
  | "sell"
  | "neutral"
  | "news";

const STYLES: Record<Variant, string> = {
  win: "bg-win/15 text-win-dark border-win/25",
  loss: "bg-loss/15 text-loss-dark border-loss/25",
  be: "bg-be/20 text-be-dark border-be/30",
  buy: "bg-buy/15 text-buy-dark border-buy/25",
  sell: "bg-sell/20 text-sell-dark border-sell/30",
  neutral: "bg-ink/10 text-ink/80 border-ink/15",
  news: "bg-ink text-white border-ink",
};

export function StatBadge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border leading-none whitespace-nowrap",
        STYLES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
