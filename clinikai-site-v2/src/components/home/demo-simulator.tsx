"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { motionTokens } from "@/lib/motion";

const fields = ["Motivo", "Antecedentes", "Examen", "Dx", "Plan", "Medicamentos"];
const fieldTargets = [86, 78, 72, 66, 74, 70];
const transcriptText =
  "Paciente con fiebre de 48 horas, tolera via oral, sin signos de dificultad respiratoria.";

type DemoSimulatorProps = {
  className?: string;
};

export function DemoSimulator({ className }: DemoSimulatorProps) {
  const reducedMotion = useReducedMotion();
  const [typedLength, setTypedLength] = useState(transcriptText.length);
  const [filledCount, setFilledCount] = useState(fields.length);

  const displayedTypedLength = reducedMotion ? transcriptText.length : typedLength;
  const displayedFilledCount = reducedMotion ? fields.length : filledCount;

  const visibleText = useMemo(
    () => transcriptText.slice(0, displayedTypedLength),
    [displayedTypedLength],
  );

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let cancelled = false;

    const schedule = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        if (!cancelled) {
          fn();
        }
      }, ms);
      timers.push(id);
    };

    const runCycle = () => {
      setTypedLength(0);
      setFilledCount(0);

      let chars = 0;

      const typeNext = () => {
        chars += 2;
        setTypedLength(Math.min(chars, transcriptText.length));

        if (chars < transcriptText.length) {
          schedule(typeNext, 42);
          return;
        }

        let fieldIndex = 0;

        const fillNext = () => {
          fieldIndex += 1;
          setFilledCount(fieldIndex);

          if (fieldIndex < fields.length) {
            schedule(fillNext, 430);
            return;
          }

          schedule(runCycle, 1450);
        };

        schedule(fillNext, 220);
      };

      schedule(typeNext, 280);
    };

    runCycle();

    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [reducedMotion]);

  return (
    <motion.div
      className={cn(
        "group relative rounded-[22px] border border-[var(--color-border)] bg-white p-5 shadow-[0_16px_44px_rgba(11,15,20,0.07)] transition-[transform,box-shadow] duration-[220ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] hover:-translate-y-[3px] hover:shadow-[0_20px_52px_rgba(11,15,20,0.12)] sm:p-6",
        className,
      )}
      whileHover={reducedMotion ? undefined : { y: -4 }}
      transition={{ duration: motionTokens.micro, ease: motionTokens.easeOutCubic }}
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-brand)]">
          Demo visual [VIDEO_DEMO]
        </p>
        <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text)]">
          30s
        </span>
      </div>

      <div className="rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="relative mb-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-white p-3">
          <div className="mb-3 flex items-center justify-between text-xs text-[color:rgb(94,107,123)]">
            <span>1. Voz ambiente</span>
            <span>2. Texto</span>
            <span>3. Campos</span>
          </div>

          <div className="relative h-10 rounded-lg bg-[var(--color-surface)] px-2">
            <div className="absolute inset-0 flex items-end gap-1 px-2 pb-2">
              {Array.from({ length: 26 }).map((_, index) => (
                <motion.span
                  key={`wave-${index}`}
                  className="block w-1 rounded-full bg-[var(--color-brand)]"
                  style={{ height: `${9 + ((index * 9) % 22)}px` }}
                  animate={
                    reducedMotion
                      ? undefined
                      : {
                          scaleY: [0.45, 1.22, 0.55],
                          opacity: [0.4, 1, 0.55],
                        }
                  }
                  transition={
                    reducedMotion
                      ? undefined
                      : {
                          duration: 1.6,
                          repeat: Number.POSITIVE_INFINITY,
                          repeatType: "mirror",
                          ease: "easeInOut",
                          delay: index * 0.05,
                        }
                  }
                />
              ))}
            </div>
          </div>

          <motion.div
            className="pointer-events-none absolute inset-y-0 w-10 rounded-full bg-[radial-gradient(circle,rgba(77,163,255,0.28)_0%,rgba(77,163,255,0)_72%)]"
            animate={reducedMotion ? undefined : { x: [8, 260, 8] }}
            transition={
              reducedMotion
                ? undefined
                : {
                    duration: 3.4,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: motionTokens.easeOutCubic,
                  }
            }
          />
        </div>

        <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-text)]">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
            Texto en tiempo real
          </p>
          <div className="h-3 rounded-full bg-[var(--color-surface)]">
            <motion.div
              className="h-full rounded-full bg-[var(--color-brand)]"
              animate={{
                width: reducedMotion
                  ? "100%"
                  : `${Math.max(8, (displayedTypedLength / transcriptText.length) * 100)}%`,
              }}
              transition={{ duration: reducedMotion ? 0 : 0.28, ease: motionTokens.easeOutCubic }}
            />
          </div>
          <p className="mt-3 min-h-10 text-xs leading-relaxed text-[color:rgb(59,70,84)]">
            {visibleText}
            {!reducedMotion ? (
              <motion.span
                className="ml-0.5 inline-block"
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY }}
                aria-hidden
              >
                |
              </motion.span>
            ) : null}
          </p>
        </div>

        <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-white p-3">
          {fields.map((field, index) => {
            const target = `${fieldTargets[index]}%`;
            const activeWidth = reducedMotion ? target : index < displayedFilledCount ? target : "8%";

            return (
              <div key={field} className="grid grid-cols-[110px_1fr] items-center gap-2">
                <span className="text-xs font-medium text-[color:rgb(59,70,84)]">{field}</span>
                <div className="h-2 rounded-full bg-[var(--color-surface)]">
                  <motion.div
                    className="h-full rounded-full bg-[var(--color-brand)]"
                    animate={{ width: activeWidth }}
                    transition={{ duration: reducedMotion ? 0 : 0.44, ease: motionTokens.easeOutCubic }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
