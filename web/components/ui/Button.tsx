"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/components/utils/cn";
import { Spinner } from "./Spinner";
import { buttonClass, type Variant, type Size } from "./buttonClass";

export { buttonClass };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  href?: string;
  external?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, href, external, icon, className, children, disabled, ...rest },
  ref,
) {
  const cls = buttonClass(variant, size, className);
  const content = (
    <>
      {loading ? <Spinner size={size === "sm" ? 13 : 15} /> : icon}
      {children}
    </>
  );
  if (href) {
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {content}
      </a>
    ) : (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
      {content}
    </button>
  );
});
