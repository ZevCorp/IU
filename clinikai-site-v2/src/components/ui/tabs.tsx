"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";

export type UseCaseTab = {
  id: string;
  label: string;
  title: string;
  story: string;
  fields: string[];
  status?: string;
};

type UseCaseTabsProps = {
  items: UseCaseTab[];
};

export function UseCaseTabs({ items }: UseCaseTabsProps) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  const active = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div className="rounded-[20px] border border-[var(--color-border)] bg-white p-4 sm:p-6">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const activeTab = item.id === active.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition-colors duration-[220ms]",
                activeTab
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)] hover:bg-[var(--color-surface)]",
              )}
              aria-pressed={activeTab}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: motionTokens.entry, ease: motionTokens.easeOutCubic }}
          className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_1fr]"
        >
          <div className="rounded-[16px] bg-[var(--color-surface)] p-5">
            {active.status ? (
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                {active.status}
              </p>
            ) : null}
            <h3 className="font-display text-2xl font-semibold text-[var(--color-text)]">
              {active.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
              {active.story}
            </p>
          </div>

          <div className="rounded-[16px] border border-[var(--color-border)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
              Campos que se llenan
            </p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--color-text)]">
              {active.fields.map((field) => (
                <li key={field} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
                  {field}
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

