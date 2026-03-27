import { CONTENT_ROLES, INTERACTIVE_ROLES, STRUCTURAL_ROLES } from "./snapshot-roles";

export type RoleRef = {
  role: string;
  name?: string;
  nth?: number;
};

export type RoleRefMap = Record<string, RoleRef>;

export type RoleSnapshotOptions = {
  interactive?: boolean;
  maxDepth?: number;
  compact?: boolean;
};

export function getRoleSnapshotStats(snapshot: string, refs: RoleRefMap) {
  const interactive = Object.values(refs).filter((ref) => INTERACTIVE_ROLES.has(ref.role)).length;
  return {
    lines: snapshot ? snapshot.split("\n").length : 0,
    chars: snapshot.length,
    refs: Object.keys(refs).length,
    interactive,
  };
}

function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

function createRoleNameTracker() {
  const counts = new Map<string, number>();
  const refsByKey = new Map<string, string[]>();
  return {
    getKey(role: string, name?: string) {
      return `${role}:${name ?? ""}`;
    },
    getNextIndex(role: string, name?: string) {
      const key = this.getKey(role, name);
      const current = counts.get(key) ?? 0;
      counts.set(key, current + 1);
      return current;
    },
    trackRef(role: string, name: string | undefined, ref: string) {
      const key = this.getKey(role, name);
      const list = refsByKey.get(key) ?? [];
      list.push(ref);
      refsByKey.set(key, list);
    },
    getDuplicateKeys() {
      const out = new Set<string>();
      for (const [key, refs] of refsByKey) {
        if (refs.length > 1) {
          out.add(key);
        }
      }
      return out;
    },
  };
}

function removeNthFromNonDuplicates(refs: RoleRefMap, tracker: ReturnType<typeof createRoleNameTracker>) {
  const duplicates = tracker.getDuplicateKeys();
  for (const [ref, data] of Object.entries(refs)) {
    const key = tracker.getKey(data.role, data.name);
    if (!duplicates.has(key)) {
      delete refs[ref]?.nth;
    }
  }
}

function compactTree(tree: string) {
  const lines = tree.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes("[ref=")) {
      result.push(line);
      continue;
    }
    if (line.includes(":") && !line.trimEnd().endsWith(":")) {
      result.push(line);
      continue;
    }

    const currentIndent = getIndentLevel(line);
    let hasRelevantChildren = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const childIndent = getIndentLevel(lines[j] || "");
      if (childIndent <= currentIndent) {
        break;
      }
      if (lines[j]?.includes("[ref=")) {
        hasRelevantChildren = true;
        break;
      }
    }
    if (hasRelevantChildren) {
      result.push(line);
    }
  }
  return result.join("\n");
}

function parseLine(line: string, options: RoleSnapshotOptions) {
  const depth = getIndentLevel(line);
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return null;
  }
  const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
  if (!match) {
    return null;
  }
  const [, prefix, roleRaw, name, suffix] = match;
  if (roleRaw.startsWith("/")) {
    return null;
  }
  return {
    prefix,
    roleRaw,
    role: roleRaw.toLowerCase(),
    name,
    suffix,
  };
}

function parseAiSnapshotRef(suffix: string): string | null {
  const match = suffix.match(/\[ref=(e\d+)\]/i);
  return match ? match[1] : null;
}

export function buildRoleSnapshotFromAriaSnapshot(
  ariaSnapshot: string,
  options: RoleSnapshotOptions = {},
): { snapshot: string; refs: RoleRefMap } {
  const lines = String(ariaSnapshot ?? "").split("\n");
  const refs: RoleRefMap = {};
  const tracker = createRoleNameTracker();
  let counter = 0;
  const nextRef = () => {
    counter += 1;
    return `e${counter}`;
  };

  const result: string[] = [];
  for (const line of lines) {
    const parsed = parseLine(line, options);
    if (!parsed) {
      if (!options.interactive && line) {
        result.push(line);
      }
      continue;
    }

    const isInteractive = INTERACTIVE_ROLES.has(parsed.role);
    const isContent = CONTENT_ROLES.has(parsed.role);
    const isStructural = STRUCTURAL_ROLES.has(parsed.role);

    if (options.interactive && !isInteractive) {
      continue;
    }
    if (options.compact && isStructural && !parsed.name) {
      continue;
    }

    const shouldHaveRef = isInteractive || (isContent && parsed.name);
    if (!shouldHaveRef) {
      result.push(line);
      continue;
    }

    const ref = nextRef();
    const nth = tracker.getNextIndex(parsed.role, parsed.name);
    tracker.trackRef(parsed.role, parsed.name, ref);
    refs[ref] = {
      role: parsed.role,
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(nth > 0 ? { nth } : {}),
    };

    let enhanced = `${parsed.prefix}${parsed.roleRaw}`;
    if (parsed.name) {
      enhanced += ` "${parsed.name}"`;
    }
    enhanced += ` [ref=${ref}]`;
    if (nth > 0) {
      enhanced += ` [nth=${nth}]`;
    }
    if (parsed.suffix) {
      enhanced += parsed.suffix;
    }
    result.push(enhanced);
  }

  removeNthFromNonDuplicates(refs, tracker);

  const tree = result.join("\n") || (options.interactive ? "(no interactive elements)" : "(empty)");
  return {
    snapshot: options.compact ? compactTree(tree) : tree,
    refs,
  };
}

export function buildRoleSnapshotFromAiSnapshot(
  aiSnapshot: string,
  options: RoleSnapshotOptions = {},
): { snapshot: string; refs: RoleRefMap } {
  const lines = String(aiSnapshot ?? "").split("\n");
  const refs: RoleRefMap = {};
  const out: string[] = [];

  for (const line of lines) {
    const parsed = parseLine(line, options);
    if (!parsed) {
      if (!options.interactive && line) {
        out.push(line);
      }
      continue;
    }

    if (options.interactive && !INTERACTIVE_ROLES.has(parsed.role)) {
      continue;
    }
    if (options.compact && STRUCTURAL_ROLES.has(parsed.role) && !parsed.name) {
      continue;
    }

    const ref = parseAiSnapshotRef(parsed.suffix);
    if (ref) {
      refs[ref] = {
        role: parsed.role,
        ...(parsed.name ? { name: parsed.name } : {}),
      };
    }
    out.push(line);
  }

  const tree = out.join("\n") || (options.interactive ? "(no interactive elements)" : "(empty)");
  return {
    snapshot: options.compact ? compactTree(tree) : tree,
    refs,
  };
}
