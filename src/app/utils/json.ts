import type { JSONValue, JSONObject, JSONArray, JsonType, Path, Segment, FieldSelection } from "../types";

export const ROOT_PATH_KEY = "[]";
export const ESTIMATE_CAP = 10000;
export const LARGE_THRESHOLD = 2000;
export const VERY_LARGE_THRESHOLD = 5000;
export const DEFAULT_AUTO_EXPAND_DEPTH = 0;
export const LARGE_AUTO_EXPAND_DEPTH = 0;

export function getJsonType(value: JSONValue): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (kind === "string") return "string";
  if (kind === "number") return "number";
  if (kind === "boolean") return "boolean";
  return "object";
}

export function formatValue(value: JSONValue, type: JsonType): string {
  if (type === "string") {
    return `"${value as string}"`;
  }
  if (type === "null") {
    return "null";
  }
  if (type === "object") {
    const keys = Object.keys(value as JSONObject).length;
    return `{${keys} ${keys === 1 ? "key" : "keys"}}`;
  }
  if (type === "array") {
    const length = (value as JSONArray).length;
    return `[${length} ${length === 1 ? "item" : "items"}]`;
  }
  return String(value);
}

export function normalizePath(path: Path): Path {
  return path.map((segment) => {
    if (typeof segment === "number") {
      return segment;
    }
    const numeric = Number(segment);
    if (!Number.isNaN(numeric) && String(numeric) === String(segment)) {
      return numeric;
    }
    return String(segment);
  });
}

export function buildSegments(path: Path): Segment[] {
  const segments: Segment[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index];
    if (typeof current === "number") {
      continue;
    }
    const next = path[index + 1];
    const nextIsIndex = typeof next === "number";
    segments.push({
      type: nextIsIndex ? "array" : "key",
      key: current,
    });
  }
  return segments;
}

export function createSelectionKey(segments: Segment[], path: Path): string {
  if (!segments.length) {
    return JSON.stringify(path);
  }
  return segments.map((segment) => `${segment.type}:${segment.key}`).join(">");
}

export function sanitizeFieldName(name: string | undefined): string {
  const raw = (name ?? "value").toString();
  let cleaned = raw
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^0-9a-zA-Z_]/g, "_");
  cleaned = cleaned.replace(/_+/g, "_").replace(/^_+/, "").toLowerCase();
  if (!cleaned) {
    cleaned = "value";
  }
  if (/^\d/.test(cleaned)) {
    cleaned = `field_${cleaned}`;
  }
  return cleaned;
}

export function generateFieldName(segments: Segment[], fallbackPath: Path): string {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.type === "key" && segment.key) {
      return sanitizeFieldName(segment.key);
    }
    if (segment.type === "array" && segment.key) {
      return sanitizeFieldName(`${segment.key}_value`);
    }
  }
  const last = fallbackPath[fallbackPath.length - 1];
  if (typeof last === "number") {
    return sanitizeFieldName(`value_${last}`);
  }
  return sanitizeFieldName((last as string | undefined) ?? "value");
}

export function ensureUniqueFieldName(
  baseName: string,
  selections: Map<string, FieldSelection>
): string {
  const usedNames = new Set(
    Array.from(selections.values()).map((selection) => selection.fieldName)
  );
  if (!usedNames.has(baseName)) {
    return baseName;
  }
  let counter = 2;
  let candidate = `${baseName}_${counter}`;
  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${baseName}_${counter}`;
  }
  return candidate;
}

export function pathToDotNotation(path: Path): string {
  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === "number") {
      return `${accumulator}[${segment}]`;
    }
    return accumulator ? `${accumulator}.${segment}` : segment;
  }, "");
}

export function collectExpandablePaths(value: JSONValue, basePath: Path, acc: Set<string>): void {
  const type = getJsonType(value);
  if (type === "object") {
    acc.add(JSON.stringify(basePath));
    Object.entries(value as JSONObject).forEach(([key, child]) => {
      collectExpandablePaths(child, [...basePath, key], acc);
    });
    return;
  }
  if (type === "array") {
    acc.add(JSON.stringify(basePath));
    (value as JSONArray).forEach((child, index) => {
      collectExpandablePaths(child, [...basePath, index], acc);
    });
  }
}

function collectExpandablePathsToDepth(
  value: JSONValue,
  basePath: Path,
  acc: Set<string>,
  maxDepth: number
): void {
  const type = getJsonType(value);
  if (maxDepth < 0) {
    return;
  }
  if (type === "object") {
    acc.add(JSON.stringify(basePath));
    if (maxDepth === 0) return;
    Object.entries(value as JSONObject).forEach(([key, child]) => {
      collectExpandablePathsToDepth(child, [...basePath, key], acc, maxDepth - 1);
    });
    return;
  }
  if (type === "array") {
    acc.add(JSON.stringify(basePath));
    if (maxDepth === 0) return;
    (value as JSONArray).forEach((child, index) => {
      collectExpandablePathsToDepth(child, [...basePath, index], acc, maxDepth - 1);
    });
  }
}

export function buildExpandedSetForDepth(value: JSONValue, depth: number): Set<string> {
  const expanded = new Set<string>();
  collectExpandablePathsToDepth(value, [], expanded, depth);
  if (expanded.size === 0) {
    expanded.add(ROOT_PATH_KEY);
  }
  return expanded;
}

export function countExpandableNodes(value: JSONValue, cap: number): number {
  let count = 0;
  const walk = (val: JSONValue): void => {
    if (count >= cap) return;
    const t = getJsonType(val);
    if (t === "object") {
      count += 1;
      if (count >= cap) return;
      Object.values(val as JSONObject).forEach((child) => {
        if (count < cap) walk(child);
      });
    } else if (t === "array") {
      count += 1;
      if (count >= cap) return;
      (val as JSONArray).forEach((child) => {
        if (count < cap) walk(child);
      });
    }
  };
  walk(value);
  return count;
}

export function collectLeafPaths(value: JSONValue, basePath: Path): Path[] {
  const type = getJsonType(value);
  if (type === "object") {
    const result: Path[] = [];
    Object.entries(value as JSONObject).forEach(([key, child]) => {
      result.push(...collectLeafPaths(child, [...basePath, key]));
    });
    return result;
  }
  if (type === "array") {
    const result: Path[] = [];
    (value as JSONArray).forEach((child, index) => {
      result.push(...collectLeafPaths(child, [...basePath, index]));
    });
    return result;
  }
  return [basePath];
}
