import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonStyles = cva(
  "inline-flex select-none items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
        subtle: "bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-hover)]",
        outline: "border border-[var(--line)] bg-transparent text-[var(--text)] hover:bg-[var(--surface-hover)]",
        ghost: "bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
        danger: "bg-[var(--negative)] text-white hover:brightness-110",
      },
      size: {
        sm: "h-7 px-2.5",
        md: "h-8 px-3",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "subtle", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonStyles({ variant, size }), className)} type={type} {...props} />;
}
