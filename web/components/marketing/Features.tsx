import { BadgeCheck, Repeat, Zap } from "lucide-react";

const FEATURES = [
  {
    icon: Zap,
    title: "Does the work",
    body: "Ask once. Jarvis writes the email, finds the time, sends the invite and files the doc. No how-to steps, no copy and paste.",
    tint: "from-[#0a84ff] to-[#5e5ce6]",
  },
  {
    icon: BadgeCheck,
    title: "Verifies every step",
    body: "After each action Jarvis re-reads Gmail, Calendar or Drive to confirm it really happened, and shows you the proof.",
    tint: "from-[#30d158] to-[#0a84ff]",
  },
  {
    icon: Repeat,
    title: "Runs on autopilot",
    body: "Turn the busywork into automations: a morning brief, newsletter cleanup, follow-up nudges. Set them once and forget them.",
    tint: "from-[#bf5af2] to-[#ff6482]",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-5 pb-24">
      <div className="divide-y divide-hairline overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-hairline">
        {FEATURES.map(({ icon: Icon, title, body, tint }) => (
          <div key={title} className="flex flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:gap-8 sm:px-10 sm:py-10">
            <div className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${tint} text-white shadow-soft`}>
              <Icon className="size-7" strokeWidth={1.5} />
            </div>
            <div className="sm:w-60 sm:shrink-0">
              <h3 className="text-[22px] font-semibold tracking-tight">{title}</h3>
            </div>
            <p className="text-[16px] leading-relaxed text-ink-2">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
