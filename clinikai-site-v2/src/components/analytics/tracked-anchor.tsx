"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { trackEvent, type AnalyticsPayload } from "@/lib/analytics";

type TrackedAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  eventName: string;
  payload?: AnalyticsPayload;
};

export function TrackedAnchor({
  eventName,
  payload,
  onClick,
  ...props
}: TrackedAnchorProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    trackEvent(eventName, payload);
    onClick?.(event);
  };

  return <a {...props} onClick={handleClick} />;
}

