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
  type: "success" | "error";
  text: string;
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
interface TreeNodeProps {
  value: JSONValue;
  label?: string | number;
  path: Path;
  level: number;
  expandedPaths: Set<string>;
  searchTerm: string;
  selectedValueKeys: Set<string>;
  maxChildrenToShow: number;
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
  onToggleExpand,
  onSelectValue,
  onSelectSubtree,
  onCopyPath,
  onCopyPython,
  onCopyJson,
}: TreeNodeProps) {
  const type = getJsonType(value);
  const isExpandable = type === "object" || type === "array";
  const pathKey = JSON.stringify(path);
  const isExpanded = isExpandable ? expandedPaths.has(pathKey) : false;
  const isSelectedValue = selectedValueKeys.has(pathKey);
  const formattedValue = formatValue(value, type);

  const search = searchTerm.trim().toLowerCase();
  const textForSearch = `${label !== undefined ? `"${label}": ` : ""}${formattedValue}`.toLowerCase();
  const matchesSearch = search.length > 0 && textForSearch.includes(search);

  const nodeContentClasses = ["node-content"];
  if (isSelectedValue) {
    nodeContentClasses.push("selected");
  }
  if (matchesSearch) {
    nodeContentClasses.push("highlight");
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
          <span className={nodeValueClasses.join(" ")}>{formattedValue}</span>
          {!isExpandable && (
            <button
              type="button"
              className="select-btn"
              onClick={(event) => {
                event.stopPropagation();
                onSelectValue(path);
              }}
            >
              Add Field
            </button>
          )}
        </div>

        <span className={`node-type type-${type}`}>{type}</span>

        <div className="node-actions">
          {isExpandable && (
            <button
              type="button"
              className="copy-btn"
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
            className="copy-btn"
            onClick={(event) => {
              event.stopPropagation();
              void onCopyPath(path);
            }}
          >
            Copy Path
          </button>
          <button
            type="button"
            className="copy-btn"
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
              className="copy-btn"
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
                  onToggleExpand={onToggleExpand}
                  onSelectValue={onSelectValue}
                  onSelectSubtree={onSelectSubtree}
                  onCopyPath={onCopyPath}
                  onCopyPython={onCopyPython}
                  onCopyJson={onCopyJson}
                />
              ))}
              {childrenToRender.isTruncated && (
                <div className="truncated-message" style={{ padding: "8px 12px", color: "#607d8b", fontStyle: "italic", fontSize: "0.85rem" }}>
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
                  onToggleExpand={onToggleExpand}
                  onSelectValue={onSelectValue}
                  onSelectSubtree={onSelectSubtree}
                  onCopyPath={onCopyPath}
                  onCopyPython={onCopyPython}
                  onCopyJson={onCopyJson}
                />
              ))}
              {childrenToRender.isTruncated && (
                <div className="truncated-message" style={{ padding: "8px 12px", color: "#607d8b", fontStyle: "italic", fontSize: "0.85rem" }}>
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
  const [message, setMessage] = useState<MessageState | null>({
    type: "success",
    text: "Sample JSON loaded.",
  });
  const [codeStatus, setCodeStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>("");
  const [maxChildrenToShow, setMaxChildrenToShow] = useState<number>(100);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = window.setTimeout(() => {
      setMessage(null);
    }, 3200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [message]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  const selectedValueKeys = useMemo(() => {
    const keys = new Set<string>();
    selectedFields.forEach((selection) => {
      keys.add(JSON.stringify(selection.rawPath));
    });
    return keys;
  }, [selectedFields]);

  const pythonCode = useMemo(
    () => generatePythonCode(selectedFields, columnName),
    [selectedFields, columnName]
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
      setJsonInput(raw);
      const processJson = () => {
        try {
          const parsed = JSON.parse(raw) as JSONValue;
          setJsonData(parsed);
          const estimated = countExpandableNodes(parsed, ESTIMATE_CAP);
          let expanded: Set<string>;

          if (estimated > VERY_LARGE_THRESHOLD) {
            expanded = new Set([ROOT_PATH_KEY]);
            setMaxChildrenToShow(50);
            setMessage({
              type: "success",
              text:
                (successMessage ?? "JSON parsed successfully!") +
                ` Very large payload detected (${estimated}+ nodes); tree left collapsed for performance.`,
            });
          } else if (estimated > LARGE_THRESHOLD) {
            expanded = buildExpandedSetForDepth(parsed, LARGE_AUTO_EXPAND_DEPTH);
            setMaxChildrenToShow(100);
            setMessage({
              type: "success",
              text:
                (successMessage ?? "JSON parsed successfully!") +
                ` Large payload detected (${estimated}+ nodes); showing collapsed view. Use ▸ controls to explore.`,
            });
          } else {
            expanded = buildExpandedSetForDepth(parsed, DEFAULT_AUTO_EXPAND_DEPTH);
            setMaxChildrenToShow(200);
            setMessage({
              type: "success",
              text:
                (successMessage ?? "JSON parsed successfully!") +
                " Tree stays collapsed; click ▸ to drill down.",
            });
          }
          setExpandedPaths(expanded);
          setSelectedFields(new Map());
          setCodeStatus("");
        } catch (error) {
          const messageText =
            error instanceof Error ? error.message : "Unknown parsing error";
          setMessage({
            type: "error",
            text: `Invalid JSON: ${messageText}`,
          });
        } finally {
          setIsLoading(false);
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
      setMessage({
        type: "error",
        text: "Please enter JSON data.",
      });
      return;
    }
    applyParsedJson(jsonInput, "JSON parsed successfully!");
    setCodeStatus("");
  }, [jsonInput, applyParsedJson]);

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
      setMessage(null);
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

  const handleSelectValue = useCallback((path: Path) => {
    setSelectedFields((previous) => {
      const normalizedPath = normalizePath(path);
      const segments = buildSegments(normalizedPath);
      const selectionKey = createSelectionKey(segments, normalizedPath);

      if (previous.has(selectionKey)) {
        const next = new Map(previous);
        next.delete(selectionKey);
        return next;
      }

      const next = new Map(previous);
      const baseFieldName = generateFieldName(segments, normalizedPath);
      const fieldName = ensureUniqueFieldName(baseFieldName, next);
      next.set(selectionKey, {
        fieldName,
        rawPath: normalizedPath,
      });
      return next;
    });
    setCodeStatus("");
  }, []);

  const handleSelectSubtree = useCallback((path: Path, value: JSONValue) => {
    const leafPaths = collectLeafPaths(value, [...path]);
    if (leafPaths.length === 0) {
      setMessage({
        type: "error",
        text: "No fields found under this node.",
      });
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
      setMessage({
        type: "success",
        text: `Added ${added} field${added === 1 ? "" : "s"} from the selected node.`,
      });
    } else if (removed > 0) {
      setMessage({
        type: "success",
        text: `Removed ${removed} field${removed === 1 ? "" : "s"} from the selected node.`,
      });
    }

    setCodeStatus("");
  }, []);

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
    setMessage({
      type: "success",
      text: "All selections removed.",
    });
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set([ROOT_PATH_KEY]));
    setMessage({
      type: "success",
      text: "All nodes collapsed.",
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    if (!jsonData) return;
    const expanded = new Set<string>();
    collectExpandablePaths(jsonData, [], expanded);
    if (expanded.size === 0) {
      expanded.add(ROOT_PATH_KEY);
    }
    setExpandedPaths(expanded);
    setMessage({
      type: "success",
      text: "All nodes expanded.",
    });
  }, [jsonData]);

  const handleCopyPath = useCallback(
    async (path: Path) => {
      if (path.length === 0) {
        setMessage({
          type: "error",
          text: "No path to copy.",
        });
        return;
      }
      const dotPath = pathToDotNotation(path);
      const success = await copyToClipboard(dotPath);
      if (success) {
        setMessage({
          type: "success",
          text: `Path copied: ${dotPath}`,
        });
      } else {
        setMessage({
          type: "error",
          text: "Unable to copy path.",
        });
      }
    },
    [copyToClipboard]
  );

  const handleCopyPythonPath = useCallback(
    async (path: Path) => {
      if (path.length === 0) {
        setMessage({
          type: "error",
          text: "No path to convert.",
        });
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
        setMessage({
          type: "success",
          text: `Python path copied: ${result}`,
        });
      } else {
        setMessage({
          type: "error",
          text: "Unable to copy Python path.",
        });
      }
    },
    [copyToClipboard]
  );

  const handleCopyJson = useCallback(
    async (value: JSONValue) => {
      try {
        const text =
          typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
        const success = await copyToClipboard(text);
        if (success) {
          setMessage({
            type: "success",
            text: "JSON fragment copied to clipboard.",
          });
        } else {
          setMessage({
            type: "error",
            text: "Unable to copy JSON fragment.",
          });
        }
      } catch {
        setMessage({
          type: "error",
          text: "Unable to copy JSON fragment.",
        });
      }
    },
    [copyToClipboard]
  );

  const handleCopyCode = useCallback(async () => {
    if (!pythonCode.trim()) {
      return;
    }
    const success = await copyToClipboard(pythonCode);
    if (success) {
      setCodeStatus("Copied!");
      setMessage({
        type: "success",
        text: "Python snippet copied to clipboard.",
      });
      window.setTimeout(() => {
        setCodeStatus("");
      }, 2000);
    } else {
      setMessage({
        type: "error",
        text: "Unable to copy Python snippet.",
      });
    }
  }, [pythonCode, copyToClipboard]);

  const selectedEntries = useMemo(
    () => Array.from(selectedFields.entries()),
    [selectedFields]
  );

  const hasPythonCode = pythonCode.trim().length > 0;

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
    <div className="app-shell" aria-busy={isLoading}>
      <div className="card">
        {isLoading && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="spinner" />
            <div className="loading-text">Loading JSON…</div>
          </div>
        )}
        <header className="header">
          <h1>🔍 JSON Explorer</h1>
          <p>Upload, inspect, and extract JSON payloads directly into Pandas.</p>
        </header>

        <section className="input-section">
          <div className="input-row">
            <div className="file-input-wrapper">
              <input
                id="file-input"
                type="file"
                accept=".json,application/json"
                className="file-input"
                onChange={handleFileUpload}
                disabled={isLoading}
              />
              <label htmlFor="file-input" className="file-input-label">
                📁 Click to upload JSON or drag & drop a file
              </label>
            </div>
            <button type="button" className="button" onClick={handleLoadSample} disabled={isLoading}>
              📋 Load Sample
            </button>
          </div>

          <textarea
            className="textarea"
            value={jsonInput}
            onChange={handleJsonInputChange}
            readOnly={isLoading}
            placeholder="Paste your JSON here..."
          />

          <div className="search-row">
            <input
              type="text"
              className="search-input"
              placeholder="🔍 Search in JSON structure..."
              value={searchTerm}
              onChange={handleSearchChange}
              disabled={isLoading}
            />
            <button type="button" className="button" onClick={handleParse} disabled={isLoading}>
              🚀 Parse JSON
            </button>
            <button type="button" className="button button-secondary" onClick={handleClearSelections} disabled={isLoading}>
              ❌ Remove All
            </button>
            {jsonData && (
              <>
                <button type="button" className="button button-secondary" onClick={handleCollapseAll} disabled={isLoading}>
                  🔽 Collapse All
                </button>
                <button type="button" className="button button-secondary" onClick={handleExpandAll} disabled={isLoading}>
                  🔼 Expand All
                </button>
              </>
            )}
          </div>
        </section>

        <section className="configuration">
          <div className="config-card">
            <h3>DataFrame Settings</h3>
            <label htmlFor="column-name-input">Pandas JSON column</label>
            <input
              id="column-name-input"
              type="text"
              value={columnName}
              onChange={handleColumnNameChange}
              disabled={isLoading}
              placeholder="e.g. templateVariables"
            />
            <p style={{ fontSize: "0.8rem", color: "#607d8b" }}>
              The column that stores the JSON payload as a dict or JSON string.
            </p>
          </div>
          <div className="config-card">
            <h3>Selection Behaviour</h3>
            <p style={{ fontSize: "0.85rem", color: "#546e7a" }}>
              Hover any value in the tree and use <strong>Add Field</strong> to include it in the
              generated snippet.
            </p>
            <p style={{ fontSize: "0.8rem", color: "#607d8b" }}>
              Click the same value again to remove it from the generated code.
            </p>
          </div>
        </section>

        {message && (
          <div className={`message ${message.type}`}>
            <span>{message.text}</span>
          </div>
        )}

        <section className="tree-shell">
          {jsonData ? (
            <div className="json-tree">
              <MemoTreeNode
                value={jsonData}
                path={[]}
                level={0}
                expandedPaths={expandedPaths}
                searchTerm={debouncedSearchTerm}
                selectedValueKeys={selectedValueKeys}
                maxChildrenToShow={maxChildrenToShow}
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

        <section className="code-panel">
          <div className="code-card">
            <div className="code-toolbar">
              <h2>Generated Python</h2>
              <button
                type="button"
                className="copy-btn"
                onClick={handleCopyCode}
                disabled={!hasPythonCode || isLoading}
                style={{ opacity: hasPythonCode && !isLoading ? 1 : 0.4, cursor: hasPythonCode && !isLoading ? "pointer" : "not-allowed" }}
              >
                Copy Code
              </button>
              {codeStatus && <span className="code-status">{codeStatus}</span>}
            </div>

            <div className={`selected-fields ${selectedEntries.length ? "" : "hidden"}`}>
              {selectedEntries.map(([selectionKey, selection]) => (
                <div key={selectionKey} className="selected-pill">
                  <span>{selection.fieldName}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveSelection(selectionKey)}
                    aria-label={`Remove ${selection.fieldName}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <pre className={`code-preview ${hasPythonCode ? "" : "empty"}`}>
              {hasPythonCode
                ? pythonCode
                : "Click a value in the JSON tree to generate the transformation snippet."}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
