"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";

export type FaqItem = {
  question: string;
  answer: string;
};

type FaqAccordionProps = {
  items: FaqItem[];
  className?: string;
};

export function FaqAccordion({ items, className }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item, index) => {
        const isOpen = openIndex === index;

        return (
          <div
            key={item.question}
            className="rounded-[18px] border border-[var(--color-border)] bg-white p-5"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              aria-controls={`faq-${index}`}
            >
              <span className="text-base font-semibold text-[var(--color-text)]">
                {item.question}
              </span>
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full border border-[var(--color-border)] text-lg leading-none transition-transform duration-[220ms]",
                  isOpen && "rotate-45",
                )}
                aria-hidden
              >
                +
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.p
                  id={`faq-${index}`}
                  key="content"
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 12 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{
                    duration: motionTokens.micro,
                    ease: motionTokens.easeOutCubic,
                  }}
                  className="overflow-hidden text-sm leading-relaxed text-[color:rgb(59,70,84)]"
                >
                  {item.answer}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

