import { cn } from "@/components/utils/cn";

export function PageContainer({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 pb-10 pt-6 sm:px-6 md:px-8 md:pt-10", wide ? "max-w-6xl" : "max-w-4xl", className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] md:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-xl text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
