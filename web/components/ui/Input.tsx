import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/components/utils/cn";

const base =
  "w-full rounded-xl bg-surface px-4 text-[15px] text-ink ring-1 ring-hairline-strong placeholder:text-ink-3 transition-shadow focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(base, "h-12", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(base, "min-h-24 resize-none py-3 leading-6", className)} {...rest} />;
});

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-[13px] text-bad">{error}</span> : hint ? <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span> : null}
    </label>
  );
}
