"use client";

import { useEffect } from "react";

import { trackEvent } from "@/lib/analytics";

const checkpoints = [25, 50, 75, 100];

export function ScrollDepthTracker() {
  useEffect(() => {
    const fired = new Set<number>();

    const onScroll = () => {
      const scrollTop = window.scrollY;
      const total = document.documentElement.scrollHeight - window.innerHeight;

      if (total <= 0) {
        return;
      }

      const percentage = Math.round((scrollTop / total) * 100);

      checkpoints.forEach((point) => {
        if (percentage >= point && !fired.has(point)) {
          fired.add(point);
          trackEvent("scroll_depth", {
            depth: point,
            path: window.location.pathname,
          });
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}

