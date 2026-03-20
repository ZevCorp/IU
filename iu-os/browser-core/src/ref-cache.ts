import type { BrowserProfileName, BrowserSnapshotElement } from "./types";

type TargetEntry = {
  nextRef: number;
  keyToRef: Map<string, string>;
  refToElement: Map<string, BrowserSnapshotElement>;
};

function scopeKey(profile: BrowserProfileName, targetId: string) {
  return `${profile}:${targetId}`;
}

function stableKeyForElement(element: Omit<BrowserSnapshotElement, "ref">, index: number): string {
  return [
    element.selector?.trim() || "",
    element.role.trim(),
    element.label.trim(),
    element.tag?.trim() || "",
    index,
  ].join("|");
}

export class BrowserRefCache {
  private readonly byTarget = new Map<string, TargetEntry>();

  apply(
    profile: BrowserProfileName,
    targetId: string,
    elements: Array<Omit<BrowserSnapshotElement, "ref">>,
  ): BrowserSnapshotElement[] {
    const scoped = scopeKey(profile, targetId);
    const entry = this.byTarget.get(scoped) ?? {
      nextRef: 1,
      keyToRef: new Map<string, string>(),
      refToElement: new Map<string, BrowserSnapshotElement>(),
    };
    const nextElements: BrowserSnapshotElement[] = [];
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i]!;
      const key = stableKeyForElement(element, i);
      let ref = entry.keyToRef.get(key);
      if (!ref) {
        ref = `e${entry.nextRef}`;
        entry.nextRef += 1;
        entry.keyToRef.set(key, ref);
      }
      const hydrated: BrowserSnapshotElement = { ref, ...element, key };
      entry.refToElement.set(ref, hydrated);
      nextElements.push(hydrated);
    }
    this.byTarget.set(scoped, entry);
    return nextElements;
  }

  resolve(profile: BrowserProfileName, targetId: string, ref: string): BrowserSnapshotElement | null {
    const entry = this.byTarget.get(scopeKey(profile, targetId));
    return entry?.refToElement.get(ref.trim()) ?? null;
  }
}
