"use client";

import { AkButton as AkButtonPrimitive } from "@swufefox/ak-ui-react";
import type { AkButtonProps } from "@swufefox/ak-ui-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * newBeing bridge to ak-ui AkButton.
 * Keeps the product's existing variant/size vocabulary so call sites stay
 * untouched, while the rendered control is the real ak-ui component.
 * AkButton already defaults type="button".
 */
export type ButtonVariant = "primary" | "subtle" | "outline" | "ghost" | "danger" | "action" | "advanced" | "light" | "default";
export type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: ReactNode;
}

const variantToAk: Record<ButtonVariant, NonNullable<AkButtonProps["variant"]>> = {
  primary: "action",
  action: "action",
  subtle: "default",
  default: "default",
  outline: "outline",
  ghost: "outline",
  danger: "action",
  advanced: "advanced",
  light: "light",
};

const sizeStyle: Record<ButtonSize, string> = {
  sm: "ak-btn-size-sm",
  md: "ak-btn-size-md",
  icon: "ak-btn-size-icon",
};

const variantStyle: Record<ButtonVariant, string> = {
  primary: "ak-btn-variant-primary",
  action: "ak-btn-variant-primary",
  subtle: "ak-btn-variant-subtle",
  default: "ak-btn-variant-subtle",
  outline: "ak-btn-variant-outline",
  ghost: "ak-btn-variant-ghost",
  danger: "ak-btn-variant-danger",
  advanced: "ak-btn-variant-primary",
  light: "ak-btn-variant-subtle",
};

export function Button({ variant = "subtle", size = "md", block = false, icon, className = "", type = "button", children, ...rest }: ButtonProps): React.JSX.Element {
  const { children: _children, ...htmlRest } = rest as ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode };
  void _children;
  return (
    <AkButtonPrimitive
      {...(htmlRest as Omit<AkButtonProps, "children" | "type" | "variant" | "block" | "className" | "icon">)}
      type={type}
      variant={variantToAk[variant]}
      icon={icon}
      block={block}
      data-size={size}
      className={`nb-button ${variantStyle[variant]} ${sizeStyle[size]} ${className}`}
    >
      {children}
    </AkButtonPrimitive>
  );
}
