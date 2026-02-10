'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState, memo } from "react";

type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue };
type JSONArray = JSONValue[];
type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";
type Path = (string | number)[];

type Segment = {
  type: "key" | "array";
  key: string;
};

interface FieldSelection {
  fieldName: string;
  rawPath: Path;
}

interface MessageState {
  type: "success" | "error" | "info";
  text: string;
  id: string;
}

interface SearchMatch {
  path: Path;
  pathKey: string;
}

const ROOT_PATH_KEY = "[]";
const ESTIMATE_CAP = 10000;
const LARGE_THRESHOLD = 2000;
const VERY_LARGE_THRESHOLD = 5000;
const DEFAULT_AUTO_EXPAND_DEPTH = 0;
const LARGE_AUTO_EXPAND_DEPTH = 0;

function collectExpandablePaths(value: JSONValue, basePath: Path, acc: Set<string>): void {
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

function buildExpandedSetForDepth(value: JSONValue, depth: number): Set<string> {
  const expanded = new Set<string>();
  collectExpandablePathsToDepth(value, [], expanded, depth);
  if (expanded.size === 0) {
    expanded.add(ROOT_PATH_KEY);
  }
  return expanded;
}

function countExpandableNodes(value: JSONValue, cap: number): number {
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

interface JSONStats {
  totalKeys: number;
  maxDepth: number;
  totalNodes: number;
  typeCount: Record<JsonType, number>;
  sizeInBytes: number;
}

function calculateJSONStats(value: JSONValue): JSONStats {
  const stats: JSONStats = {
    totalKeys: 0,
    maxDepth: 0,
    totalNodes: 0,
    typeCount: {
      string: 0,
      number: 0,
      boolean: 0,
      null: 0,
      object: 0,
      array: 0,
    },
    sizeInBytes: 0,
  };

  const walk = (val: JSONValue, depth: number): void => {
    const type = getJsonType(val);
    stats.typeCount[type] += 1;
    stats.totalNodes += 1;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (type === "object") {
      const obj = val as JSONObject;
      stats.totalKeys += Object.keys(obj).length;
      Object.values(obj).forEach((child) => walk(child, depth + 1));
    } else if (type === "array") {
      (val as JSONArray).forEach((child) => walk(child, depth + 1));
    }
  };

  walk(value, 0);
  stats.sizeInBytes = new Blob([JSON.stringify(value)]).size;
  return stats;
}

function collectLeafPaths(value: JSONValue, basePath: Path): Path[] {
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
const SAMPLE_JSON: JSONObject = {
  templateVariables: {
    toxicity: "medium",
    request_type: "content_generation",
    risk_category: "standard",
    metadata: {
      user_id: "user_12345",
      session: {
        id: "sess_98765",
        origin: "web",
        features: ["rephrasing", "summarization", "translation"],
      },
      tags: ["premium", "verified", "beta"],
    },
    history: [
      {
        timestamp: "2024-04-01T10:05:00Z",
        action: "prompt_submission",
        result: {
          toxicity: "low",
          risk_category: "standard",
        },
      },
      {
        timestamp: "2024-04-01T10:06:30Z",
        action: "guardrail_check",
        result: {
          toxicity: "medium",
          risk_category: "elevated",
        },
      },
    ],
    orders: [
      {
        id: "ORD-001",
        items: [
          { name: "Laptop", price: 999.99, quantity: 1 },
          { name: "Mouse", price: 29.99, quantity: 2 },
        ],
      },
      {
        id: "ORD-002",
        items: [{ name: "Keyboard", price: 79.99, quantity: 1 }],
      },
    ],
  },
  inputText: "Tell me a fun fact about space.",
};

const SAMPLE_JSON_STRING = JSON.stringify(SAMPLE_JSON, null, 2);

function getJsonType(value: JSONValue): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (kind === "string") return "string";
  if (kind === "number") return "number";
  if (kind === "boolean") return "boolean";
  return "object";
}

function getTypeIcon(type: JsonType): string {
  switch (type) {
    case "string":
      return "📝";
    case "number":
      return "🔢";
    case "boolean":
      return "✅";
    case "null":
      return "⭕";
    case "object":
      return "📦";
    case "array":
      return "📋";
    default:
      return "❓";
  }
}

function formatValue(value: JSONValue, type: JsonType): string {
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

function normalizePath(path: Path): Path {
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

function buildSegments(path: Path): Segment[] {
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

function createSelectionKey(segments: Segment[], path: Path): string {
  if (!segments.length) {
    return JSON.stringify(path);
  }
  return segments.map((segment) => `${segment.type}:${segment.key}`).join(">");
}

function sanitizeFieldName(name: string | undefined): string {
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

function generateFieldName(segments: Segment[], fallbackPath: Path): string {
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

function ensureUniqueFieldName(
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

function escapeForPythonString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildPythonPathLiteral(path: Path): string {
  const parts = path.map((segment) => {
    if (typeof segment === "number") {
      return segment.toString();
    }
    return `"${escapeForPythonString(segment)}"`;
  });
  return `[${parts.join(", ")}]`;
}

function pathToDotNotation(path: Path): string {
  return path.reduce<string>((accumulator, segment) => {
    if (typeof segment === "number") {
      return `${accumulator}[${segment}]`;
    }
    return accumulator ? `${accumulator}.${segment}` : segment;
  }, "");
}

function trimPathForColumn(path: Path, columnName: string): Path {
  if (
    path.length > 0 &&
    typeof path[0] === "string" &&
    path[0] === columnName
  ) {
    return path.slice(1);
  }
  return path;
}

function buildSimplePythonCode(
  selections: FieldSelection[],
  columnName: string
): string {
  const columnLiteral = escapeForPythonString(columnName);
  const seriesLines = selections.map((selection) => {
    const fieldLiteral = escapeForPythonString(selection.fieldName);
    const pathLiteral = buildPythonPathLiteral(
      trimPathForColumn(selection.rawPath, columnName)
    );
    return `            "${fieldLiteral}": safe_get(obj, ${pathLiteral})`;
  });
  const docString = `Extracts ${selections.length} field(s): ${selections
    .map((selection) => selection.fieldName)
    .join(", ")} from JSON column "${columnName}".`;

  return [
    `import pandas as pd`,
    ``,
    `def transform(df):`,
    `    """${docString}"""`,
    `    import json`,
    ``,
    `    def parse_json(val):`,
    `        if isinstance(val, dict):`,
    `            return val`,
    `        if pd.isna(val):`,
    `            return {}`,
    `        try:`,
    `            return json.loads(val)`,
    `        except Exception:`,
    `            return {}`,
    ``,
    `    def safe_get(obj, path):`,
    `        current = obj`,
    `        for step in path:`,
    `            if isinstance(step, int):`,
    `                if isinstance(current, (list, tuple)) and 0 <= step < len(current):`,
    `                    current = current[step]`,
    `                else:`,
    `                    return None`,
    `            else:`,
    `                if isinstance(current, dict):`,
    `                    current = current.get(step)`,
    `                else:`,
    `                    return None`,
    `        return current`,
    ``,
    `    def extract_fields(val):`,
    `        obj = parse_json(val)`,
    ``,
    `        return pd.Series({`,
    `${seriesLines.join(",\n")}`,
    `        })`,
    ``,
    `    extracted = df["${columnLiteral}"].apply(extract_fields)`,
    `    return df.join(extracted)`,
  ].join("\n");
}

function generatePythonCode(
  selections: Map<string, FieldSelection>,
  columnName: string
): string {
  if (selections.size === 0) {
    return "";
  }
  return buildSimplePythonCode(Array.from(selections.values()), columnName);
}

function generateJavaScriptCode(selections: FieldSelection[]): string {
  if (selections.length === 0) return "";

  const extractFields = selections.map((sel) => {
    const pathAccess = sel.rawPath
      .map((seg) => typeof seg === "number" ? `[${seg}]` : `['${seg}']`)
      .join("");
    return `  ${sel.fieldName}: data${pathAccess}`;
  }).join(",\n");

  return `// Extract fields from JSON
function extractFields(data) {
  return {
${extractFields}
  };
}

// Usage:
const result = extractFields(jsonData);
console.log(result);`;
}

function generateTypeScriptCode(selections: FieldSelection[]): string {
  if (selections.length === 0) return "";

  const interfaceFields = selections.map((sel) => {
    return `  ${sel.fieldName}: any;`;
  }).join("\n");

  const extractFields = selections.map((sel) => {
    const pathAccess = sel.rawPath
      .map((seg) => typeof seg === "number" ? `[${seg}]` : `['${seg}']`)
      .join("");
    return `  ${sel.fieldName}: data${pathAccess}`;
  }).join(",\n");

  return `// TypeScript interface
interface ExtractedData {
${interfaceFields}
}

// Extract fields from JSON
function extractFields(data: any): ExtractedData {
  return {
${extractFields}
  };
}

// Usage:
const result: ExtractedData = extractFields(jsonData);
console.log(result);`;
}

function generateGoCode(selections: FieldSelection[]): string {
  if (selections.length === 0) return "";

  const structFields = selections.map((sel) => {
    const fieldName = sel.fieldName.charAt(0).toUpperCase() + sel.fieldName.slice(1);
    return `\t${fieldName} interface{} \`json:"${sel.rawPath[sel.rawPath.length - 1]}"\``;
  }).join("\n");

  return `package main

import (
\t"encoding/json"
\t"fmt"
)

type ExtractedData struct {
${structFields}
}

func main() {
\tvar data map[string]interface{}
\t// Unmarshal your JSON into data
\t
\tvar result ExtractedData
\tjsonBytes, _ := json.Marshal(data)
\tjson.Unmarshal(jsonBytes, &result)
\t
\tfmt.Println(result)
}`;
}

function generateRustCode(selections: FieldSelection[]): string {
  if (selections.length === 0) return "";

  const structFields = selections.map((sel) => {
    return `    pub ${sel.fieldName}: serde_json::Value,`;
  }).join("\n");

  return `use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractedData {
${structFields}
}

fn extract_fields(data: &Value) -> ExtractedData {
    serde_json::from_value(data.clone())
        .expect("Failed to extract fields")
}

// Usage:
// let json_data: Value = serde_json::from_str(&json_string)?;
// let result = extract_fields(&json_data);
// println!("{:?}", result);`;
}

type CodeLanguage = "python" | "javascript" | "typescript" | "go" | "rust";

function generateCode(
  language: CodeLanguage,
  selections: Map<string, FieldSelection>,
  columnName: string
): string {
  const selectionsArray = Array.from(selections.values());

  switch (language) {
    case "python":
      return generatePythonCode(selections, columnName);
    case "javascript":
      return generateJavaScriptCode(selectionsArray);
    case "typescript":
      return generateTypeScriptCode(selectionsArray);
    case "go":
      return generateGoCode(selectionsArray);
    case "rust":
      return generateRustCode(selectionsArray);
    default:
      return "";
  }
}

function flattenJSON(
  obj: JSONValue,
  prefix: string = "",
  result: Record<string, JSONValue> = {}
): Record<string, JSONValue> {
  if (obj === null || typeof obj !== "object") {
    result[prefix] = obj;
    return result;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      flattenJSON(item, prefix ? `${prefix}[${index}]` : `[${index}]`, result);
    });
  } else {
    Object.entries(obj).forEach(([key, value]) => {
      const newPrefix = prefix ? `${prefix}.${key}` : key;
      flattenJSON(value, newPrefix, result);
    });
  }

  return result;
}

function testJSONPath(data: JSONValue, pathStr: string): JSONValue | null {
  if (!pathStr.trim()) return null;

  try {
    // Simple dot notation path (e.g., "user.name", "items[0].price")
    const keys = pathStr.split(/\.|\[|\]/).filter(k => k);
    let current: JSONValue = data;

    for (const key of keys) {
      if (current === null || typeof current !== "object") {
        return null;
      }

      const index = parseInt(key, 10);
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index];
      } else if (typeof current === "object" && !Array.isArray(current)) {
        current = (current as JSONObject)[key];
      } else {
        return null;
      }
    }

    return current;
  } catch {
    return null;
  }
}

function computeJSONDiff(
  obj1: JSONValue,
  obj2: JSONValue,
  path: Path = [],
  result: Map<string, 'added' | 'removed' | 'modified'> = new Map()
): Map<string, 'added' | 'removed' | 'modified'> {
  const pathKey = JSON.stringify(path);

  // Different types
  if (getJsonType(obj1) !== getJsonType(obj2)) {
    result.set(pathKey, 'modified');
    return result;
  }

  const type = getJsonType(obj1);

  // Primitive values
  if (type !== 'object' && type !== 'array') {
    if (obj1 !== obj2) {
      result.set(pathKey, 'modified');
    }
    return result;
  }

  // Arrays
  if (type === 'array') {
    const arr1 = obj1 as JSONArray;
    const arr2 = obj2 as JSONArray;
    const maxLen = Math.max(arr1.length, arr2.length);

    for (let i = 0; i < maxLen; i++) {
      const newPath = [...path, i];
      const key = JSON.stringify(newPath);

      if (i >= arr1.length) {
        result.set(key, 'added');
      } else if (i >= arr2.length) {
        result.set(key, 'removed');
      } else {
        computeJSONDiff(arr1[i], arr2[i], newPath, result);
      }
    }
    return result;
  }

  // Objects
  if (type === 'object') {
    const obj1Keys = new Set(Object.keys(obj1 as JSONObject));
    const obj2Keys = new Set(Object.keys(obj2 as JSONObject));
    const allKeys = new Set([...obj1Keys, ...obj2Keys]);

    allKeys.forEach((key) => {
      const newPath = [...path, key];
      const pathKey = JSON.stringify(newPath);

      if (!obj1Keys.has(key)) {
        result.set(pathKey, 'added');
      } else if (!obj2Keys.has(key)) {
        result.set(pathKey, 'removed');
      } else {
        computeJSONDiff((obj1 as JSONObject)[key], (obj2 as JSONObject)[key], newPath, result);
      }
    });
  }

  return result;
}

interface TreeNodeProps {
  value: JSONValue;
  label?: string | number;
  path: Path;
  level: number;
  expandedPaths: Set<string>;
  searchTerm: string;
  selectedValueKeys: Set<string>;
  maxChildrenToShow: number;
  typeFilter: Set<JsonType>;
  diffResults?: Map<string, 'added' | 'removed' | 'modified'>;
  onToggleExpand: (pathKey: string) => void;
  onSelectValue: (path: Path) => void;
  onSelectSubtree: (path: Path, value: JSONValue) => void;
  onCopyPath: (path: Path) => Promise<void>;
  onCopyPython: (path: Path) => Promise<void>;
  onCopyJson: (value: JSONValue) => Promise<void>;
}

function TreeNode({
  value,
  label,
  path,
  level,
  expandedPaths,
  searchTerm,
  selectedValueKeys,
  maxChildrenToShow,
  typeFilter,
  diffResults,
  onToggleExpand,
  onSelectValue,
  onSelectSubtree,
  onCopyPath,
  onCopyPython,
  onCopyJson,
}: TreeNodeProps) {
  const [copyFeedback, setCopyFeedback] = useState(false);
  const type = getJsonType(value);
  const isExpandable = type === "object" || type === "array";
  const pathKey = JSON.stringify(path);
  const isExpanded = isExpandable ? expandedPaths.has(pathKey) : false;
  const isSelectedValue = selectedValueKeys.has(pathKey);
  const formattedValue = formatValue(value, type);

  const search = searchTerm.trim().toLowerCase();
  const textForSearch = `${label !== undefined ? `"${label}": ` : ""}${formattedValue}`.toLowerCase();
  const matchesSearch = search.length > 0 && textForSearch.includes(search);

  const diffStatus = diffResults?.get(pathKey);

  const isFiltered = typeFilter.size > 0 && !typeFilter.has(type);
  if (isFiltered && !isExpandable) {
    return null;
  }

  const nodeContentClasses = ["node-content"];
  if (isSelectedValue) {
    nodeContentClasses.push("selected");
  }
  if (matchesSearch) {
    nodeContentClasses.push("highlight");
  }
  if (diffStatus) {
    nodeContentClasses.push(`diff-${diffStatus}`);
  }

  const nodeValueClasses = ["node-value"];
  if (isSelectedValue) {
    nodeValueClasses.push("selected");
  }

  const childrenToRender = useMemo(() => {
    if (!isExpandable || !isExpanded) return null;

    if (type === "object") {
      const entries = Object.entries(value as JSONObject);
      if (entries.length > maxChildrenToShow) {
        return { entries: entries.slice(0, maxChildrenToShow), total: entries.length, isTruncated: true };
      }
      return { entries, total: entries.length, isTruncated: false };
    }

    if (type === "array") {
      const arr = value as JSONArray;
      if (arr.length > maxChildrenToShow) {
        return { items: arr.slice(0, maxChildrenToShow), total: arr.length, isTruncated: true };
      }
      return { items: arr, total: arr.length, isTruncated: false };
    }

    return null;
  }, [value, type, isExpanded, isExpandable, maxChildrenToShow]);

  return (
    <div className="tree-node" style={{ marginLeft: level === 0 ? 0 : 12 }}>
      <div className={nodeContentClasses.join(" ")}>
        {isExpandable ? (
          <button
            type="button"
            className={`expand-btn ${isExpanded ? "expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(pathKey);
            }}
            aria-label="Toggle children"
          >
            ▸
          </button>
        ) : (
          <span className="expand-spacer" />
        )}

        {label !== undefined && (
          <span className="node-key">&quot;{label}&quot;:</span>
        )}

        <div className="value-wrapper">
          <span className="type-icon">{getTypeIcon(type)}</span>
          <span className={nodeValueClasses.join(" ")}>{formattedValue}</span>
          {!isExpandable && (
            <>
              <button
                type="button"
                className="button button-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectValue(path);
                }}
              >
                Add Field
              </button>
              <button
                type="button"
                className="button button-icon"
                onClick={async (event) => {
                  event.stopPropagation();
                  try {
                    const valueStr = type === "string" ? String(value) : JSON.stringify(value);
                    await navigator.clipboard.writeText(valueStr);
                    setCopyFeedback(true);
                    setTimeout(() => setCopyFeedback(false), 1000);
                  } catch {
                    // Ignore errors
                  }
                }}
                title="Copy value"
              >
                {copyFeedback ? "✓" : "📋"}
              </button>
            </>
          )}
        </div>

        <span className={`node-type type-${type}`}>{type}</span>

        <div className="node-actions">
          {isExpandable && (
            <button
              type="button"
              className="button button-secondary"
              onClick={(event) => {
                event.stopPropagation();
                onSelectSubtree(path, value);
              }}
            >
              Add All Fields
            </button>
          )}
          <button
            type="button"
            className="button button-secondary"
            onClick={(event) => {
              event.stopPropagation();
              void onCopyPath(path);
            }}
          >
            Copy Path
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={(event) => {
              event.stopPropagation();
              void onCopyPython(path);
            }}
          >
            Copy Python
          </button>
          {isExpandable && (
            <button
              type="button"
              className="button button-secondary"
              onClick={(event) => {
                event.stopPropagation();
                void onCopyJson(value);
              }}
            >
              Copy JSON
            </button>
          )}
        </div>
      </div>

      {isExpandable && isExpanded && childrenToRender && (
        <div className="children">
          {type === "object" && childrenToRender.entries && (
            <>
              {childrenToRender.entries.map(([childKey, childValue]) => (
                <TreeNode
                  key={`${pathKey}.${childKey}`}
                  value={childValue}
                  label={childKey}
                  path={[...path, childKey]}
                  level={level + 1}
                  expandedPaths={expandedPaths}
                  searchTerm={searchTerm}
                  selectedValueKeys={selectedValueKeys}
                  maxChildrenToShow={maxChildrenToShow}
                  typeFilter={typeFilter}
                  diffResults={diffResults}
                  onToggleExpand={onToggleExpand}
                  onSelectValue={onSelectValue}
                  onSelectSubtree={onSelectSubtree}
                  onCopyPath={onCopyPath}
                  onCopyPython={onCopyPython}
                  onCopyJson={onCopyJson}
                />
              ))}
              {childrenToRender.isTruncated && (
                <div className="truncated-message">
                  ... and {childrenToRender.total - maxChildrenToShow} more keys (showing first {maxChildrenToShow})
                </div>
              )}
            </>
          )}
          {type === "array" && childrenToRender.items && (
            <>
              {childrenToRender.items.map((item, index) => (
                <TreeNode
                  key={`${pathKey}.${index}`}
                  value={item}
                  label={index}
                  path={[...path, index]}
                  level={level + 1}
                  expandedPaths={expandedPaths}
                  searchTerm={searchTerm}
                  selectedValueKeys={selectedValueKeys}
                  maxChildrenToShow={maxChildrenToShow}
                  typeFilter={typeFilter}
                  diffResults={diffResults}
                  onToggleExpand={onToggleExpand}
                  onSelectValue={onSelectValue}
                  onSelectSubtree={onSelectSubtree}
                  onCopyPath={onCopyPath}
                  onCopyPython={onCopyPython}
                  onCopyJson={onCopyJson}
                />
              ))}
              {childrenToRender.isTruncated && (
                <div className="truncated-message">
                  ... and {childrenToRender.total - maxChildrenToShow} more items (showing first {maxChildrenToShow})
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const MemoTreeNode = memo(TreeNode);
export default function Home() {
  const [jsonInput, setJsonInput] = useState<string>(SAMPLE_JSON_STRING);
  const [jsonData, setJsonData] = useState<JSONValue | null>(SAMPLE_JSON);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [columnName, setColumnName] = useState<string>("templateVariables");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    new Set([ROOT_PATH_KEY])
  );
  const [selectedFields, setSelectedFields] = useState<Map<string, FieldSelection>>(
    new Map()
  );
  const [messages, setMessages] = useState<MessageState[]>([
    {
      type: "success",
      text: "Sample JSON loaded.",
      id: Date.now().toString(),
    },
  ]);
  const [codeStatus, setCodeStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>("");
  const [maxChildrenToShow, setMaxChildrenToShow] = useState<number>(100);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [jsonStats, setJsonStats] = useState<JSONStats | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);
  const [showFAB, setShowFAB] = useState<boolean>(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);
  const [selectedLanguage, setSelectedLanguage] = useState<CodeLanguage>("python");
  const [selectionHistory, setSelectionHistory] = useState<Map<string, FieldSelection>[]>([new Map()]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [typeFilter, setTypeFilter] = useState<Set<JsonType>>(new Set());
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingFieldName, setEditingFieldName] = useState<string>("");
  const [urlInput, setUrlInput] = useState<string>("");
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [useRegexSearch, setUseRegexSearch] = useState<boolean>(false);
  const [jsonPathInput, setJsonPathInput] = useState<string>("");
  const [jsonPathResult, setJsonPathResult] = useState<JSONValue | null>(null);
  const [showFlattened, setShowFlattened] = useState<boolean>(false);
  const [flattenedJson, setFlattenedJson] = useState<Record<string, JSONValue>>({});
  const [performanceMetrics, setPerformanceMetrics] = useState<{
    parseTime: number;
    renderTime: number;
    totalTime: number;
    nodeCount: number;
  } | null>(null);
  const [bookmarks, setBookmarks] = useState<Array<{ name: string; json: string }>>([]);
  const [bookmarkName, setBookmarkName] = useState<string>("");
  const [showNodeActions, setShowNodeActions] = useState<boolean>(true);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [compareJsonInput, setCompareJsonInput] = useState<string>("");
  const [compareJsonData, setCompareJsonData] = useState<JSONValue | null>(null);
  const [diffResults, setDiffResults] = useState<Map<string, 'added' | 'removed' | 'modified'>>(new Map());
  const [activeTab, setActiveTab] = useState<'tree' | 'code' | 'compare' | 'settings'>('tree');

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < selectionHistory.length - 1;

  const addToast = useCallback((type: MessageState['type'], text: string) => {
    const id = Date.now().toString();
    setMessages((prev) => [...prev, { type, text, id }]);
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const savedJSON = localStorage.getItem('savedJSON');
    const savedColumnName = localStorage.getItem('savedColumnName');
    const savedBookmarks = localStorage.getItem('bookmarks');

    if (savedTheme === 'dark') {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark-mode');
    }

    if (savedJSON) {
      try {
        setJsonInput(savedJSON);
        applyParsedJson(savedJSON, "Restored from auto-save.");
      } catch {
        // Ignore invalid saved JSON
      }
    }

    if (savedColumnName) {
      setColumnName(savedColumnName);
    }

    if (savedBookmarks) {
      try {
        const parsed = JSON.parse(savedBookmarks);
        setBookmarks(parsed);
      } catch {
        // Ignore invalid bookmarks
      }
    }
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && e.key === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.search-input')?.focus();
      } else if (isCmdOrCtrl && e.key === 'e') {
        e.preventDefault();
        handleExpandAll();
      } else if (isCmdOrCtrl && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handleCollapseAll();
      } else if (isCmdOrCtrl && e.key === 's') {
        e.preventDefault();
        void handleCopyCode();
      } else if (isCmdOrCtrl && e.key === 'd') {
        e.preventDefault();
        setIsDarkMode(!isDarkMode);
      } else if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowShortcuts(!showShortcuts);
      } else if ((e.key === 'F3' && !e.shiftKey) || (isCmdOrCtrl && !e.shiftKey && e.key === 'g')) {
        e.preventDefault();
        if (searchMatches.length > 0) {
          setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);
        }
      } else if ((e.key === 'F3' && e.shiftKey) || (isCmdOrCtrl && e.shiftKey && e.key === 'g')) {
        e.preventDefault();
        if (searchMatches.length > 0) {
          setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
        }
      } else if (isCmdOrCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) {
          setHistoryIndex((prev) => prev - 1);
          setSelectedFields(selectionHistory[historyIndex - 1]);
        }
      } else if (isCmdOrCtrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo) {
          setHistoryIndex((prev) => prev + 1);
          setSelectedFields(selectionHistory[historyIndex + 1]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [isDarkMode, showShortcuts, searchMatches.length, canUndo, canRedo, historyIndex, selectionHistory]);

  useEffect(() => {
    if (!jsonData || !debouncedSearchTerm.trim()) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      return;
    }

    const matches: SearchMatch[] = [];
    let searchPattern: RegExp | null = null;
    const search = debouncedSearchTerm.toLowerCase();

    // Try to create regex pattern if regex mode is enabled
    if (useRegexSearch) {
      try {
        searchPattern = new RegExp(debouncedSearchTerm, 'i');
      } catch {
        // Invalid regex, fall back to plain search
        searchPattern = null;
      }
    }

    const findMatches = (value: JSONValue, path: Path): void => {
      const type = getJsonType(value);
      const pathKey = JSON.stringify(path);
      const formattedValue = formatValue(value, type);
      const label = path[path.length - 1];
      const textForSearch = `${label !== undefined ? `"${label}": ` : ""}${formattedValue}`;

      const isMatch = searchPattern
        ? searchPattern.test(textForSearch)
        : textForSearch.toLowerCase().includes(search);

      if (isMatch) {
        matches.push({ path, pathKey });
      }

      if (type === "object") {
        Object.entries(value as JSONObject).forEach(([key, child]) => {
          findMatches(child, [...path, key]);
        });
      } else if (type === "array") {
        (value as JSONArray).forEach((child, index) => {
          findMatches(child, [...path, index]);
        });
      }
    };

    findMatches(jsonData, []);
    setSearchMatches(matches);
    setCurrentMatchIndex(0);
  }, [jsonData, debouncedSearchTerm, useRegexSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (jsonInput.trim()) {
        localStorage.setItem('savedJSON', jsonInput);
      }
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [jsonInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem('savedColumnName', columnName);
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [columnName]);

  useEffect(() => {
    if (showFlattened && jsonData) {
      const flattened = flattenJSON(jsonData);
      setFlattenedJson(flattened);
    }
  }, [showFlattened, jsonData]);

  useEffect(() => {
    if (jsonData && jsonPathInput.trim()) {
      const result = testJSONPath(jsonData, jsonPathInput);
      setJsonPathResult(result);
    } else {
      setJsonPathResult(null);
    }
  }, [jsonData, jsonPathInput]);

  const selectedValueKeys = useMemo(() => {
    const keys = new Set<string>();
    selectedFields.forEach((selection) => {
      keys.add(JSON.stringify(selection.rawPath));
    });
    return keys;
  }, [selectedFields]);

  const generatedCode = useMemo(
    () => generateCode(selectedLanguage, selectedFields, columnName),
    [selectedLanguage, selectedFields, columnName]
  );

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const applyParsedJson = useCallback(
    (raw: string, successMessage?: string) => {
      setIsLoading(true);
      setIsParsing(true);
      setJsonInput(raw);
      const parseStart = performance.now();

      const processJson = () => {
        try {
          const parsed = JSON.parse(raw) as JSONValue;
          const parseEnd = performance.now();
          const parseTime = parseEnd - parseStart;

          const renderStart = performance.now();
          setJsonData(parsed);
          const estimated = countExpandableNodes(parsed, ESTIMATE_CAP);
          let expanded: Set<string>;

          if (estimated > VERY_LARGE_THRESHOLD) {
            expanded = new Set([ROOT_PATH_KEY]);
            setMaxChildrenToShow(50);
            addToast("success", (successMessage ?? "JSON parsed successfully!") + ` Very large payload detected (${estimated}+ nodes); tree left collapsed for performance.`);
          } else if (estimated > LARGE_THRESHOLD) {
            expanded = buildExpandedSetForDepth(parsed, LARGE_AUTO_EXPAND_DEPTH);
            setMaxChildrenToShow(100);
            addToast("success", (successMessage ?? "JSON parsed successfully!") + ` Large payload detected (${estimated}+ nodes); showing collapsed view. Use ▸ controls to explore.`);
          } else {
            expanded = buildExpandedSetForDepth(parsed, DEFAULT_AUTO_EXPAND_DEPTH);
            setMaxChildrenToShow(200);
            addToast("success", (successMessage ?? "JSON parsed successfully!") + " Tree stays collapsed; click ▸ to drill down.");
          }
          setExpandedPaths(expanded);
          setSelectedFields(new Map());
          setCodeStatus("");
          setJsonStats(calculateJSONStats(parsed));

          const renderEnd = performance.now();
          const renderTime = renderEnd - renderStart;

          setPerformanceMetrics({
            parseTime: parseTime,
            renderTime: renderTime,
            totalTime: parseTime + renderTime,
            nodeCount: estimated,
          });
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Unknown parsing error";
          addToast("error", `Invalid JSON: ${messageText}`);
        } finally {
          setIsLoading(false);
          setIsParsing(false);
        }
      };

      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as any).requestIdleCallback(processJson, { timeout: 1000 });
      } else {
        setTimeout(processJson, 0);
      }
    },
    []
  );

  const handleParse = useCallback(() => {
    if (!jsonInput.trim()) {
      addToast("error", "Please enter JSON data.");
      return;
    }
    applyParsedJson(jsonInput, "JSON parsed successfully!");
    setCodeStatus("");
  }, [jsonInput, applyParsedJson, addToast]);

  const handleLoadSample = useCallback(() => {
    applyParsedJson(SAMPLE_JSON_STRING, "Sample JSON loaded.");
    setCodeStatus("");
  }, [applyParsedJson]);

  const handleFileUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        const text = String(loadEvent.target?.result ?? "");
        applyParsedJson(text, "JSON file parsed successfully!");
        setCodeStatus("");
      };
      reader.readAsText(file);
    },
    [applyParsedJson]
  );

  const handleJsonInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setJsonInput(event.target.value);
    },
    []
  );

  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(event.target.value);
    },
    []
  );

  const handleColumnNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setColumnName(event.target.value);
      setCodeStatus("");
    },
    []
  );
  const handleToggleExpand = useCallback((pathKey: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  }, []);

  const addToHistory = useCallback((newSelections: Map<string, FieldSelection>) => {
    setSelectionHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(new Map(newSelections));
      return newHistory;
    });
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  const handleSelectValue = useCallback((path: Path) => {
    setSelectedFields((previous) => {
      const normalizedPath = normalizePath(path);
      const segments = buildSegments(normalizedPath);
      const selectionKey = createSelectionKey(segments, normalizedPath);

      let next: Map<string, FieldSelection>;
      if (previous.has(selectionKey)) {
        next = new Map(previous);
        next.delete(selectionKey);
      } else {
        next = new Map(previous);
        const baseFieldName = generateFieldName(segments, normalizedPath);
        const fieldName = ensureUniqueFieldName(baseFieldName, next);
        next.set(selectionKey, {
          fieldName,
          rawPath: normalizedPath,
        });
      }

      addToHistory(next);
      return next;
    });
    setCodeStatus("");
  }, [addToHistory]);

  const handleSelectSubtree = useCallback((path: Path, value: JSONValue) => {
    const leafPaths = collectLeafPaths(value, [...path]);
    if (leafPaths.length === 0) {
      addToast("error", "No fields found under this node.");
      return;
    }

    let added = 0;
    let removed = 0;

    setSelectedFields((previous) => {
      const next = new Map(previous);
      const normalizedEntries = leafPaths.map((leafPath) => {
        const normalizedPath = normalizePath(leafPath);
        const segments = buildSegments(normalizedPath);
        const selectionKey = createSelectionKey(segments, normalizedPath);
        return { normalizedPath, segments, selectionKey };
      });

      const allSelected = normalizedEntries.every(({ selectionKey }) =>
        next.has(selectionKey)
      );

      if (allSelected) {
        normalizedEntries.forEach(({ selectionKey }) => {
          if (next.delete(selectionKey)) {
            removed += 1;
          }
        });
        return next;
      }

      normalizedEntries.forEach(({ normalizedPath, segments, selectionKey }) => {
        if (next.has(selectionKey)) {
          return;
        }
        const baseFieldName = generateFieldName(segments, normalizedPath);
        const fieldName = ensureUniqueFieldName(baseFieldName, next);
        next.set(selectionKey, {
          fieldName,
          rawPath: normalizedPath,
        });
        added += 1;
      });

      return next;
    });

    if (added > 0) {
      addToast("success", `Added ${added} field${added === 1 ? "" : "s"} from the selected node.`);
    } else if (removed > 0) {
      addToast("success", `Removed ${removed} field${removed === 1 ? "" : "s"} from the selected node.`);
    }

    setCodeStatus("");
  }, [addToast]);

  const handleRemoveSelection = useCallback((selectionKey: string) => {
    setSelectedFields((previous) => {
      if (!previous.has(selectionKey)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(selectionKey);
      return next;
    });
    setCodeStatus("");
  }, []);

  const handleClearSelections = useCallback(() => {
    setSelectedFields(new Map());
    setCodeStatus("");
    addToast("success", "All selections removed.");
  }, [addToast]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set([ROOT_PATH_KEY]));
    addToast("success", "All nodes collapsed.");
  }, [addToast]);

  const handleExpandAll = useCallback(() => {
    if (!jsonData) return;
    const expanded = new Set<string>();
    collectExpandablePaths(jsonData, [], expanded);
    if (expanded.size === 0) {
      expanded.add(ROOT_PATH_KEY);
    }
    setExpandedPaths(expanded);
    addToast("success", "All nodes expanded.");
  }, [jsonData, addToast]);

  const handleCopyPath = useCallback(
    async (path: Path) => {
      if (path.length === 0) {
        addToast("error", "No path to copy.");
        return;
      }
      const dotPath = pathToDotNotation(path);
      const success = await copyToClipboard(dotPath);
      if (success) {
        addToast("success", `Path copied: ${dotPath}`);
      } else {
        addToast("error", "Unable to copy path.");
      }
    },
    [copyToClipboard, addToast]
  );

  const handleCopyPythonPath = useCallback(
    async (path: Path) => {
      if (path.length === 0) {
        addToast("error", "No path to convert.");
        return;
      }
      const pythonPath = path
        .map((segment) =>
          typeof segment === "number" ? `[${segment}]` : `["${segment}"]`
        )
        .join("");
      const result = `task${pythonPath}`;
      const success = await copyToClipboard(result);
      if (success) {
        addToast("success", `Python path copied: ${result}`);
      } else {
        addToast("error", "Unable to copy Python path.");
      }
    },
    [copyToClipboard, addToast]
  );

  const handleCopyJson = useCallback(
    async (value: JSONValue) => {
      try {
        const text =
          typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
        const success = await copyToClipboard(text);
        if (success) {
          addToast("success", "JSON fragment copied to clipboard.");
        } else {
          addToast("error", "Unable to copy JSON fragment.");
        }
      } catch {
        addToast("error", "Unable to copy JSON fragment.");
      }
    },
    [copyToClipboard, addToast]
  );

  const handleCopyCode = useCallback(async () => {
    if (!generatedCode.trim()) {
      return;
    }
    const success = await copyToClipboard(generatedCode);
    if (success) {
      setCodeStatus("Copied!");
      addToast("success", `${selectedLanguage.toUpperCase()} code copied to clipboard.`);
      window.setTimeout(() => {
        setCodeStatus("");
      }, 2000);
    } else {
      addToast("error", "Unable to copy code snippet.");
    }
  }, [generatedCode, copyToClipboard, addToast, selectedLanguage]);

  const handleBeautifyJSON = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonInput);
      const beautified = JSON.stringify(parsed, null, 2);
      setJsonInput(beautified);
      addToast("success", "JSON beautified successfully!");
    } catch {
      addToast("error", "Invalid JSON - cannot beautify.");
    }
  }, [jsonInput, addToast]);

  const handleMinifyJSON = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonInput);
      const minified = JSON.stringify(parsed);
      setJsonInput(minified);
      addToast("success", "JSON minified successfully!");
    } catch {
      addToast("error", "Invalid JSON - cannot minify.");
    }
  }, [jsonInput, addToast]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const jsonFile = files.find((f) => f.name.endsWith('.json') || f.type === 'application/json');

      if (jsonFile) {
        const reader = new FileReader();
        reader.onload = (loadEvent) => {
          const text = String(loadEvent.target?.result ?? "");
          applyParsedJson(text, "JSON file loaded via drag & drop!");
          setCodeStatus("");
        };
        reader.readAsText(jsonFile);
      } else {
        addToast("error", "Please drop a valid JSON file.");
      }
    },
    [applyParsedJson, addToast]
  );

  const handleLoadFromUrl = useCallback(async () => {
    if (!urlInput.trim()) {
      addToast("error", "Please enter a URL.");
      return;
    }

    setIsLoadingUrl(true);
    try {
      const response = await fetch(urlInput);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      applyParsedJson(text, "JSON loaded from URL!");
      setUrlInput("");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to fetch URL";
      addToast("error", `Failed to load JSON: ${errorMsg}`);
    } finally {
      setIsLoadingUrl(false);
    }
  }, [urlInput, applyParsedJson, addToast]);

  const handleSaveBookmark = useCallback(() => {
    if (!bookmarkName.trim()) {
      addToast("error", "Please enter a bookmark name.");
      return;
    }

    if (!jsonInput.trim()) {
      addToast("error", "No JSON to bookmark.");
      return;
    }

    const newBookmark = { name: bookmarkName, json: jsonInput };
    const updated = [...bookmarks, newBookmark];
    setBookmarks(updated);
    localStorage.setItem('bookmarks', JSON.stringify(updated));
    setBookmarkName("");
    addToast("success", `Bookmark "${bookmarkName}" saved!`);
  }, [bookmarkName, jsonInput, bookmarks, addToast]);

  const handleLoadBookmark = useCallback((json: string) => {
    applyParsedJson(json, "Bookmark loaded!");
  }, [applyParsedJson]);

  const handleDeleteBookmark = useCallback((index: number) => {
    const updated = bookmarks.filter((_, i) => i !== index);
    setBookmarks(updated);
    localStorage.setItem('bookmarks', JSON.stringify(updated));
    addToast("success", "Bookmark deleted.");
  }, [bookmarks, addToast]);

  const handleCompareJSON = useCallback(() => {
    if (!compareJsonInput.trim()) {
      addToast("error", "Please enter JSON to compare.");
      return;
    }

    try {
      const parsed = JSON.parse(compareJsonInput) as JSONValue;
      setCompareJsonData(parsed);

      if (jsonData) {
        const diff = computeJSONDiff(jsonData, parsed);
        setDiffResults(diff);
        addToast("success", `Comparison complete! Found ${diff.size} differences.`);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown parsing error";
      addToast("error", `Invalid JSON: ${messageText}`);
    }
  }, [compareJsonInput, jsonData, addToast]);

  const handleClearCompare = useCallback(() => {
    setCompareMode(false);
    setCompareJsonInput("");
    setCompareJsonData(null);
    setDiffResults(new Map());
    addToast("info", "Comparison cleared.");
  }, [addToast]);

  const handleExportCSV = useCallback(() => {
    if (selectedFields.size === 0 || !jsonData) {
      addToast("error", "Please select fields first.");
      return;
    }

    const headers = Array.from(selectedFields.values()).map((sel) => sel.fieldName);
    const rows: string[][] = [];

    const extractRow = (data: JSONValue): string[] => {
      return Array.from(selectedFields.values()).map((sel) => {
        let current: JSONValue = data;
        for (const segment of sel.rawPath) {
          if (current === null || current === undefined) return "";
          if (typeof segment === "number" && Array.isArray(current)) {
            current = current[segment];
          } else if (typeof segment === "string" && typeof current === "object" && !Array.isArray(current)) {
            current = (current as JSONObject)[segment];
          } else {
            return "";
          }
        }
        return current === null || current === undefined ? "" : String(current);
      });
    };

    if (Array.isArray(jsonData)) {
      jsonData.forEach((item) => {
        rows.push(extractRow(item));
      });
    } else {
      rows.push(extractRow(jsonData));
    }

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "export.csv";
    link.click();
    URL.revokeObjectURL(url);

    addToast("success", "CSV file downloaded!");
  }, [selectedFields, jsonData, addToast]);

  const handleExportSelections = useCallback(() => {
    if (selectedFields.size === 0) {
      addToast("error", "No selections to export.");
      return;
    }

    const selections = Array.from(selectedFields.entries()).map(([key, value]) => ({
      key,
      fieldName: value.fieldName,
      rawPath: value.rawPath,
    }));

    const blob = new Blob([JSON.stringify(selections, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "field-selections.json";
    link.click();
    URL.revokeObjectURL(url);

    addToast("success", "Selections exported!");
  }, [selectedFields, addToast]);

  const handleImportSelections = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(String(e.target?.result ?? ""));
        const newSelections = new Map<string, FieldSelection>();

        imported.forEach((item: { key: string; fieldName: string; rawPath: Path }) => {
          newSelections.set(item.key, {
            fieldName: item.fieldName,
            rawPath: item.rawPath,
          });
        });

        setSelectedFields(newSelections);
        addToast("success", `Imported ${newSelections.size} field selections!`);
      } catch {
        addToast("error", "Invalid selections file.");
      }
    };
    reader.readAsText(file);
  }, [addToast]);

  const handleEditFieldName = useCallback((selectionKey: string, currentName: string) => {
    setEditingField(selectionKey);
    setEditingFieldName(currentName);
  }, []);

  const handleSaveFieldName = useCallback((selectionKey: string) => {
    if (!editingFieldName.trim()) {
      addToast("error", "Field name cannot be empty.");
      return;
    }

    setSelectedFields((prev) => {
      const next = new Map(prev);
      const selection = next.get(selectionKey);
      if (selection) {
        next.set(selectionKey, {
          ...selection,
          fieldName: editingFieldName.trim(),
        });
      }
      return next;
    });

    setEditingField(null);
    setEditingFieldName("");
    addToast("success", "Field name updated!");
  }, [editingFieldName, addToast]);

  const toggleTypeFilter = useCallback((type: JsonType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const selectedEntries = useMemo(
    () => Array.from(selectedFields.entries()),
    [selectedFields]
  );

  const hasGeneratedCode = generatedCode.trim().length > 0;

  useEffect(() => {
    if (!jsonData) {
      setIsLoading(false);
      return;
    }
    if (expandedPaths.size <= 1) {
      setIsLoading(true);
      const estimated = countExpandableNodes(jsonData, ESTIMATE_CAP);
      let expanded: Set<string>;
      if (estimated > VERY_LARGE_THRESHOLD) {
        expanded = new Set([ROOT_PATH_KEY]);
        setMaxChildrenToShow(50);
      } else if (estimated > LARGE_THRESHOLD) {
        expanded = buildExpandedSetForDepth(jsonData, LARGE_AUTO_EXPAND_DEPTH);
        setMaxChildrenToShow(100);
      } else {
        expanded = buildExpandedSetForDepth(jsonData, DEFAULT_AUTO_EXPAND_DEPTH);
        setMaxChildrenToShow(200);
      }
      setExpandedPaths(expanded);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, [jsonData, expandedPaths.size]);

  return (
    <>
      <div className="app-background" />
      <div className="container">
        <header className="app-header">
          <div className="header-content">
            <div className="header-logo">
              🔍 JSON Explorer
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={() => setIsDarkMode(!isDarkMode)}
                aria-label="Toggle dark mode"
                title="Toggle dark mode (Cmd/Ctrl+D)"
              />
            </div>
          </div>
        </header>

        <div className="split-layout">
          <div className="left-pane">
            <div className="input-section">
              <h2 className="section-title">📝 JSON Input</h2>

              <div className="button-row">
                <label htmlFor="file-input" className="button button-secondary">
                  📁 Upload File
                  <input
                    id="file-input"
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                    disabled={isLoading}
                  />
                </label>
                <button type="button" className="button button-secondary" onClick={handleLoadSample} disabled={isLoading}>
                  📋 Load Sample
                </button>
              </div>

          <div
            className={`textarea-wrapper ${isDragging ? 'dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <textarea
              className="textarea"
              value={jsonInput}
              onChange={handleJsonInputChange}
              readOnly={isLoading}
              placeholder="Paste your JSON here..."
            />
            {isDragging && (
              <div className="drop-overlay">
                <div className="drop-message">📎 Drop JSON file here</div>
              </div>
            )}
          </div>

              <div className="button-row">
                <button type="button" className="button button-secondary" onClick={handleBeautifyJSON} disabled={isLoading}>
                  ✨ Beautify
                </button>
                <button type="button" className="button button-secondary" onClick={handleMinifyJSON} disabled={isLoading}>
                  🗜️ Minify
                </button>
              </div>


              <div className="input-group">
                <input
                  type="text"
                  className="input search-input"
                  placeholder={useRegexSearch ? "🔍 Regex search..." : "🔍 Search in JSON..."}
                  value={searchTerm}
                  onChange={handleSearchChange}
                  disabled={isLoading}
                />
              </div>

              <div className="button-row">
                <button type="button" className="button button-primary" onClick={handleParse} disabled={isLoading}>
                  🚀 Parse JSON
                </button>
                {jsonData && (
                  <>
                    <button type="button" className="button button-secondary" onClick={handleExpandAll} disabled={isLoading}>
                      🔼 Expand
                    </button>
                    <button type="button" className="button button-secondary" onClick={handleCollapseAll} disabled={isLoading}>
                      🔽 Collapse
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="right-pane">
            <div className="tabs-container">
              <div className="tabs-list">
                <button
                  className={`tab ${activeTab === 'tree' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tree')}
                >
                  🌳 Tree View
                </button>
                <button
                  className={`tab ${activeTab === 'code' ? 'active' : ''}`}
                  onClick={() => setActiveTab('code')}
                >
                  💻 Generated Code
                </button>
                <button
                  className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
                  onClick={() => setActiveTab('settings')}
                >
                  ⚙️ Settings
                </button>
              </div>
            </div>

            <div className={`tab-panel ${activeTab === 'tree' ? 'active' : ''}`}>
              <div className="tree-container">
        <section className={`tree-shell ${!showNodeActions ? 'progressive-disclosure' : ''}`}>
          {isParsing ? (
            <div className="skeleton-loader">
              <div className="skeleton-line" style={{ width: '70%' }}></div>
              <div className="skeleton-line" style={{ width: '85%', marginLeft: '24px' }}></div>
              <div className="skeleton-line" style={{ width: '60%', marginLeft: '24px' }}></div>
              <div className="skeleton-line" style={{ width: '90%' }}></div>
              <div className="skeleton-line" style={{ width: '75%', marginLeft: '24px' }}></div>
              <div className="skeleton-line" style={{ width: '80%', marginLeft: '48px' }}></div>
              <div className="skeleton-line" style={{ width: '65%', marginLeft: '48px' }}></div>
              <div className="skeleton-line" style={{ width: '70%' }}></div>
            </div>
          ) : jsonData ? (
            <div className="json-tree">
              <MemoTreeNode
                value={jsonData}
                path={[]}
                level={0}
                expandedPaths={expandedPaths}
                searchTerm={debouncedSearchTerm}
                selectedValueKeys={selectedValueKeys}
                maxChildrenToShow={maxChildrenToShow}
                typeFilter={typeFilter}
                diffResults={compareMode ? diffResults : undefined}
                onToggleExpand={handleToggleExpand}
                onSelectValue={handleSelectValue}
                onSelectSubtree={handleSelectSubtree}
                onCopyPath={handleCopyPath}
                onCopyPython={handleCopyPythonPath}
                onCopyJson={handleCopyJson}
              />
            </div>
          ) : (
            <div className="empty-state">
              Parse JSON to explore its structure and generate Python snippets.
            </div>
          )}
        </section>
              </div>
            </div>

            <div className={`tab-panel ${activeTab === 'code' ? 'active' : ''}`}>
        <section className="code-panel">
          <div className="code-card">
            <div className="code-toolbar">
              <h2>💻 Generated Python</h2>
              <button
                type="button"
                className="button button-primary"
                onClick={handleCopyCode}
                disabled={!hasGeneratedCode || isLoading}
              >
                📋 Copy Code
              </button>
              {codeStatus && <span className="status-badge success">{codeStatus}</span>}
            </div>

            <div className={`selected-fields ${selectedEntries.length ? "" : "hidden"}`}>
              {selectedEntries.map(([selectionKey, selection]) => (
                <div key={selectionKey} className="selected-pill">
                  {editingField === selectionKey ? (
                    <input
                      type="text"
                      className="field-name-input"
                      value={editingFieldName}
                      onChange={(e) => setEditingFieldName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveFieldName(selectionKey);
                        } else if (e.key === 'Escape') {
                          setEditingField(null);
                        }
                      }}
                      onBlur={() => handleSaveFieldName(selectionKey)}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span
                        className="field-name-display"
                        onClick={() => handleEditFieldName(selectionKey, selection.fieldName)}
                        title="Click to edit field name"
                      >
                        {selection.fieldName}
                      </span>
                      <button
                        type="button"
                        className="remove-field-btn"
                        onClick={() => handleRemoveSelection(selectionKey)}
                        aria-label={`Remove ${selection.fieldName}`}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <pre className={`code-preview ${hasGeneratedCode ? "" : "empty"}`}>
              {hasGeneratedCode
                ? generatedCode
                : "Click a value in the JSON tree to generate the transformation snippet."}
            </pre>
          </div>
        </section>
            </div>

            <div className={`tab-panel ${activeTab === 'settings' ? 'active' : ''}`}>
              <div className="settings-container">
                <h2 className="settings-title">⚙️ Settings</h2>

                <div className="settings-section">
                  <h3 className="section-heading">🎨 Appearance</h3>
                  <div className="setting-item">
                    <label className="setting-label">
                      <input
                        type="checkbox"
                        checked={showNodeActions}
                        onChange={(e) => setShowNodeActions(e.target.checked)}
                        className="setting-checkbox"
                      />
                      <span className="setting-text">
                        <strong>Always show node actions</strong>
                        <small>When disabled, action buttons appear only on hover for a cleaner view</small>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="section-heading">📊 DataFrame Settings</h3>
                  <div className="setting-item">
                    <label className="setting-label">
                      <span className="setting-text">
                        <strong>Pandas JSON column</strong>
                        <small>The column that stores the JSON payload as a dict or JSON string</small>
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={columnName}
                      onChange={handleColumnNameChange}
                      disabled={isLoading}
                      placeholder="e.g. templateVariables"
                    />
                  </div>
                </div>

                {jsonStats && (
                  <div className="settings-section">
                    <h3 className="section-heading">📈 JSON Statistics</h3>
                    <div className="stats-grid">
                      <div className="stat-card">
                        <div className="stat-label">Total Nodes</div>
                        <div className="stat-value">{jsonStats.totalNodes.toLocaleString()}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Max Depth</div>
                        <div className="stat-value">{jsonStats.maxDepth}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Total Keys</div>
                        <div className="stat-value">{jsonStats.totalKeys.toLocaleString()}</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Size</div>
                        <div className="stat-value">
                          {jsonStats.sizeInBytes < 1024
                            ? `${jsonStats.sizeInBytes} B`
                            : jsonStats.sizeInBytes < 1024 * 1024
                            ? `${(jsonStats.sizeInBytes / 1024).toFixed(1)} KB`
                            : `${(jsonStats.sizeInBytes / (1024 * 1024)).toFixed(2)} MB`}
                        </div>
                      </div>
                    </div>
                    <div className="type-stats">
                      {jsonStats.typeCount.string > 0 && (
                        <div className="type-stat-item">
                          <span className="type-stat-icon">📝</span>
                          <span className="type-name">Strings</span>
                          <span className="type-count">{jsonStats.typeCount.string}</span>
                        </div>
                      )}
                      {jsonStats.typeCount.number > 0 && (
                        <div className="type-stat-item">
                          <span className="type-stat-icon">🔢</span>
                          <span className="type-name">Numbers</span>
                          <span className="type-count">{jsonStats.typeCount.number}</span>
                        </div>
                      )}
                      {jsonStats.typeCount.boolean > 0 && (
                        <div className="type-stat-item">
                          <span className="type-stat-icon">✅</span>
                          <span className="type-name">Booleans</span>
                          <span className="type-count">{jsonStats.typeCount.boolean}</span>
                        </div>
                      )}
                      {jsonStats.typeCount.object > 0 && (
                        <div className="type-stat-item">
                          <span className="type-stat-icon">📦</span>
                          <span className="type-name">Objects</span>
                          <span className="type-count">{jsonStats.typeCount.object}</span>
                        </div>
                      )}
                      {jsonStats.typeCount.array > 0 && (
                        <div className="type-stat-item">
                          <span className="type-stat-icon">📋</span>
                          <span className="type-name">Arrays</span>
                          <span className="type-count">{jsonStats.typeCount.array}</span>
                        </div>
                      )}
                      {jsonStats.typeCount.null > 0 && (
                        <div className="type-stat-item">
                          <span className="type-stat-icon">⭕</span>
                          <span className="type-name">Nulls</span>
                          <span className="type-count">{jsonStats.typeCount.null}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {performanceMetrics && (
                  <div className="settings-section">
                    <h3 className="section-heading">⚡ Performance Metrics</h3>
                    <div className="stats-grid">
                      <div className="stat-card">
                        <div className="stat-label">Parse Time</div>
                        <div className="stat-value">{performanceMetrics.parseTime.toFixed(2)} ms</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Render Time</div>
                        <div className="stat-value">{performanceMetrics.renderTime.toFixed(2)} ms</div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-label">Total Time</div>
                        <div className="stat-value">{performanceMetrics.totalTime.toFixed(2)} ms</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="settings-section">
                  <h3 className="section-heading">🔍 Search Options</h3>
                  <div className="setting-item">
                    <label className="setting-label">
                      <input
                        type="checkbox"
                        checked={useRegexSearch}
                        onChange={(e) => setUseRegexSearch(e.target.checked)}
                        className="setting-checkbox"
                      />
                      <span className="setting-text">
                        <strong>Use regex search</strong>
                        <small>Enable regular expression matching in the search field</small>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="section-heading">🏷️ Type Filter</h3>
                  <div className="setting-item">
                    <small className="setting-text"><small>Select types to show in the tree (empty = show all)</small></small>
                    <div className="button-row">
                      {(['string', 'number', 'boolean', 'null', 'object', 'array'] as JsonType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`button ${typeFilter.has(t) ? 'button-primary' : 'button-secondary'}`}
                          onClick={() => toggleTypeFilter(t)}
                        >
                          {getTypeIcon(t)} {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="section-heading">🌐 Load from URL</h3>
                  <div className="setting-item">
                    <div className="input-group">
                      <input
                        type="url"
                        className="input"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://api.example.com/data.json"
                        disabled={isLoadingUrl}
                      />
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={handleLoadFromUrl}
                        disabled={isLoadingUrl || !urlInput.trim()}
                      >
                        {isLoadingUrl ? 'Loading...' : 'Fetch'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="section-heading">🔖 Bookmarks</h3>
                  <div className="setting-item">
                    <div className="input-group">
                      <input
                        type="text"
                        className="input"
                        value={bookmarkName}
                        onChange={(e) => setBookmarkName(e.target.value)}
                        placeholder="Bookmark name..."
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveBookmark(); }}
                      />
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={handleSaveBookmark}
                        disabled={!bookmarkName.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  {bookmarks.length > 0 && (
                    <div className="setting-item">
                      {bookmarks.map((bookmark, index) => (
                        <div key={index} className="button-row" style={{ marginBottom: 'var(--space-sm)' }}>
                          <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>{bookmark.name}</span>
                          <button type="button" className="button button-secondary" onClick={() => handleLoadBookmark(bookmark.json)}>Load</button>
                          <button type="button" className="button button-secondary" onClick={() => handleDeleteBookmark(index)}>Delete</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="settings-section">
                  <h3 className="section-heading">🔄 Compare Mode</h3>
                  <div className="setting-item">
                    <label className="setting-label">
                      <input
                        type="checkbox"
                        checked={compareMode}
                        onChange={(e) => {
                          setCompareMode(e.target.checked);
                          if (!e.target.checked) handleClearCompare();
                        }}
                        className="setting-checkbox"
                      />
                      <span className="setting-text">
                        <strong>Enable comparison mode</strong>
                        <small>Compare current JSON with another document to see differences in Tree View</small>
                      </span>
                    </label>
                  </div>
                  {compareMode && (
                    <div className="setting-item">
                      <textarea
                        className="textarea"
                        value={compareJsonInput}
                        onChange={(e) => setCompareJsonInput(e.target.value)}
                        placeholder="Paste JSON to compare..."
                        style={{ minHeight: '150px' }}
                      />
                      <div className="button-row" style={{ marginTop: 'var(--space-md)' }}>
                        <button type="button" className="button button-primary" onClick={handleCompareJSON} disabled={!compareJsonInput.trim()}>
                          Compare
                        </button>
                        <button type="button" className="button button-secondary" onClick={handleClearCompare}>
                          Clear
                        </button>
                      </div>
                      {diffResults.size > 0 && (
                        <p style={{ marginTop: 'var(--space-md)', color: 'var(--text-secondary)' }}>
                          Found {diffResults.size} difference{diffResults.size !== 1 ? 's' : ''} (shown in Tree View)
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {jsonData && (
                  <div className="settings-section">
                    <h3 className="section-heading">🎯 JSONPath Tester</h3>
                    <div className="setting-item">
                      <input
                        type="text"
                        className="input"
                        value={jsonPathInput}
                        onChange={(e) => setJsonPathInput(e.target.value)}
                        placeholder="e.g. templateVariables.metadata.user_id"
                      />
                      {jsonPathResult !== null && (
                        <pre className="code-preview" style={{ marginTop: 'var(--space-md)', minHeight: 'auto' }}>
                          {typeof jsonPathResult === 'object'
                            ? JSON.stringify(jsonPathResult, null, 2)
                            : String(jsonPathResult)}
                        </pre>
                      )}
                      {jsonPathInput.trim() && jsonPathResult === null && (
                        <p style={{ marginTop: 'var(--space-sm)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Path not found</p>
                      )}
                    </div>
                  </div>
                )}

                {jsonData && (
                  <div className="settings-section">
                    <h3 className="section-heading">📑 Flattened View</h3>
                    <div className="setting-item">
                      <label className="setting-label">
                        <input
                          type="checkbox"
                          checked={showFlattened}
                          onChange={(e) => {
                            setShowFlattened(e.target.checked);
                            if (e.target.checked && !flattenedJson) {
                              setFlattenedJson(flattenJSON(jsonData));
                            }
                          }}
                          className="setting-checkbox"
                        />
                        <span className="setting-text">
                          <strong>Show flattened JSON</strong>
                          <small>Display all leaf values as flat dot-notation paths</small>
                        </span>
                      </label>
                    </div>
                    {showFlattened && flattenedJson && (
                      <div className="setting-item">
                        <pre className="code-preview" style={{ maxHeight: '300px', overflowY: 'auto', minHeight: 'auto' }}>
                          {JSON.stringify(flattenedJson, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                <div className="settings-section">
                  <h3 className="section-heading">📤 Export / Import</h3>
                  <div className="setting-item">
                    <div className="button-row">
                      <button type="button" className="button button-secondary" onClick={handleExportCSV} disabled={selectedFields.size === 0}>
                        📊 Export CSV
                      </button>
                      <button type="button" className="button button-secondary" onClick={handleExportSelections} disabled={selectedFields.size === 0}>
                        💾 Export Selections
                      </button>
                      <label className="button button-secondary">
                        📂 Import Selections
                        <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportSelections} />
                      </label>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        <div className="fab-container">
          <button
            type="button"
            className={`fab-main ${showFAB ? 'active' : ''}`}
            onClick={() => setShowFAB(!showFAB)}
            aria-label="Quick actions"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {showFAB ? (
                <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              ) : (
                <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>
              )}
            </svg>
          </button>
          {showFAB && (
            <div className="fab-menu">
              <button
                type="button"
                className="fab-item"
                onClick={() => { void handleCopyCode(); setShowFAB(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span className="fab-label">Copy</span>
              </button>
              <button
                type="button"
                className="fab-item"
                onClick={() => { handleExpandAll(); setShowFAB(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
                <span className="fab-label">Expand</span>
              </button>
              <button
                type="button"
                className="fab-item"
                onClick={() => { handleCollapseAll(); setShowFAB(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
                <span className="fab-label">Collapse</span>
              </button>
              <button
                type="button"
                className="fab-item"
                onClick={() => { handleClearSelections(); setShowFAB(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                <span className="fab-label">Clear</span>
              </button>
              <button
                type="button"
                className="fab-item"
                onClick={() => { setShowShortcuts(true); setShowFAB(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/>
                </svg>
                <span className="fab-label">Shortcuts</span>
              </button>
            </div>
          )}
        </div>

        {showShortcuts && (
          <div className="shortcuts-modal" onClick={() => setShowShortcuts(false)}>
            <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
              <div className="shortcuts-header">
                <h3>⌨️ Keyboard Shortcuts</h3>
                <button
                  type="button"
                  className="close-shortcuts"
                  onClick={() => setShowShortcuts(false)}
                >
                  ✕
                </button>
              </div>
              <div className="shortcuts-list">
                <div className="shortcut-item">
                  <kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd>
                  <span>Focus search</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd/Ctrl</kbd> + <kbd>E</kbd>
                  <span>Expand all nodes</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>
                  <span>Collapse all nodes</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd/Ctrl</kbd> + <kbd>S</kbd>
                  <span>Copy generated code</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd>
                  <span>Toggle dark mode</span>
                </div>
                <div className="shortcut-item">
                  <kbd>?</kbd>
                  <span>Toggle this panel</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="toast-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`toast toast-${msg.type}`}>
              <span className="toast-icon">
                {msg.type === "success" ? "✓" : msg.type === "error" ? "✕" : "ℹ"}
              </span>
              <span className="toast-text">{msg.text}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setMessages((prev) => prev.filter((m) => m.id !== msg.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
