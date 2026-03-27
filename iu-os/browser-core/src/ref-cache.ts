import type { BrowserProfileName, BrowserSnapshotElement } from "./types";

type TargetEntry = {
  refToElement: Map<string, BrowserSnapshotElement>;
};

function scopeKey(profile: BrowserProfileName, targetId: string) {
  return `${profile}:${targetId}`;
}

export class BrowserRefCache {
  private readonly byTarget = new Map<string, TargetEntry>();

  store(
    profile: BrowserProfileName,
    targetId: string,
    elements: BrowserSnapshotElement[],
  ): BrowserSnapshotElement[] {
    const scoped = scopeKey(profile, targetId);
    const entry: TargetEntry = {
      refToElement: new Map<string, BrowserSnapshotElement>(),
    };
    for (const element of elements) {
      if (!element.ref?.trim()) continue;
      entry.refToElement.set(element.ref.trim(), element);
    }
    this.byTarget.set(scoped, entry);
    return elements;
  }

  resolve(profile: BrowserProfileName, targetId: string, ref: string): BrowserSnapshotElement | null {
    const entry = this.byTarget.get(scopeKey(profile, targetId));
    return entry?.refToElement.get(ref.trim()) ?? null;
  }
}
