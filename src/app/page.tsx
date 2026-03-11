'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { JSONValue, JSONObject, FieldSelection, MessageState, Path } from "./types";
import {
  ROOT_PATH_KEY,
  ESTIMATE_CAP,
  LARGE_THRESHOLD,
  VERY_LARGE_THRESHOLD,
  DEFAULT_AUTO_EXPAND_DEPTH,
  LARGE_AUTO_EXPAND_DEPTH,
  collectExpandablePaths,
  buildExpandedSetForDepth,
  countExpandableNodes,
  collectLeafPaths,
  normalizePath,
  buildSegments,
  createSelectionKey,
  generateFieldName,
  ensureUniqueFieldName,
  pathToDotNotation,
} from "./utils/json";
import { generatePythonCode, buildPythonAccessPath } from "./utils/python";
import MemoTreeNode from "./components/TreeNode";
import PythonCodePreview from "./components/PythonCodePreview";

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
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>("");
  const [maxChildrenToShow, setMaxChildrenToShow] = useState<number>(100);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timer);
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
                ` Large payload detected (${estimated}+ nodes); showing collapsed view. Use \u25b8 controls to explore.`,
            });
          } else {
            expanded = buildExpandedSetForDepth(parsed, DEFAULT_AUTO_EXPAND_DEPTH);
            setMaxChildrenToShow(200);
            setMessage({
              type: "success",
              text:
                (successMessage ?? "JSON parsed successfully!") +
                " Tree stays collapsed; click \u25b8 to drill down.",
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
        (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => void })
          .requestIdleCallback(processJson, { timeout: 1000 });
      } else {
        setTimeout(processJson, 0);
      }
    },
    []
  );

  const handleParse = useCallback(() => {
    if (!jsonInput.trim()) {
      setMessage({ type: "error", text: "Please enter JSON data." });
      return;
    }
    applyParsedJson(jsonInput, "JSON parsed successfully!");
    setCodeStatus("");
  }, [jsonInput, applyParsedJson]);

  const handleLoadSample = useCallback(() => {
    applyParsedJson(SAMPLE_JSON_STRING, "Sample JSON loaded.");
    setCodeStatus("");
  }, [applyParsedJson]);

  const processFile = useCallback(
    (file: File) => {
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

  const handleFileUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file && (file.type === "application/json" || file.name.endsWith(".json"))) {
        processFile(file);
      } else if (file) {
        setMessage({ type: "error", text: "Please drop a .json file." });
      }
    },
    [processFile]
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
      next.set(selectionKey, { fieldName, rawPath: normalizedPath });
      return next;
    });
    setCodeStatus("");
  }, []);

  const handleSelectSubtree = useCallback((path: Path, value: JSONValue) => {
    const leafPaths = collectLeafPaths(value, [...path]);
    if (leafPaths.length === 0) {
      setMessage({ type: "error", text: "No fields found under this node." });
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
          if (next.delete(selectionKey)) removed += 1;
        });
        return next;
      }

      normalizedEntries.forEach(({ normalizedPath, segments, selectionKey }) => {
        if (next.has(selectionKey)) return;
        const baseFieldName = generateFieldName(segments, normalizedPath);
        const fieldName = ensureUniqueFieldName(baseFieldName, next);
        next.set(selectionKey, { fieldName, rawPath: normalizedPath });
        added += 1;
      });

      return next;
    });

    if (added > 0) {
      setMessage({ type: "success", text: `Added ${added} field${added === 1 ? "" : "s"} from the selected node.` });
    } else if (removed > 0) {
      setMessage({ type: "success", text: `Removed ${removed} field${removed === 1 ? "" : "s"} from the selected node.` });
    }

    setCodeStatus("");
  }, []);

  const handleRemoveSelection = useCallback((selectionKey: string) => {
    setSelectedFields((previous) => {
      if (!previous.has(selectionKey)) return previous;
      const next = new Map(previous);
      next.delete(selectionKey);
      return next;
    });
    setCodeStatus("");
  }, []);

  const handleClearSelections = useCallback(() => {
    setSelectedFields(new Map());
    setCodeStatus("");
    setMessage({ type: "success", text: "All selections removed." });
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set([ROOT_PATH_KEY]));
    setMessage({ type: "success", text: "All nodes collapsed." });
  }, []);

  const handleExpandAll = useCallback(() => {
    if (!jsonData) return;
    const expanded = new Set<string>();
    collectExpandablePaths(jsonData, [], expanded);
    if (expanded.size === 0) expanded.add(ROOT_PATH_KEY);
    setExpandedPaths(expanded);
    setMessage({ type: "success", text: "All nodes expanded." });
  }, [jsonData]);

  const handleCopyPath = useCallback(
    async (path: Path) => {
      if (path.length === 0) {
        setMessage({ type: "error", text: "No path to copy." });
        return;
      }
      const dotPath = pathToDotNotation(path);
      const success = await copyToClipboard(dotPath);
      setMessage(success
        ? { type: "success", text: `Path copied: ${dotPath}` }
        : { type: "error", text: "Unable to copy path." });
    },
    [copyToClipboard]
  );

  const handleCopyPythonPath = useCallback(
    async (path: Path) => {
      if (path.length === 0) {
        setMessage({ type: "error", text: "No path to convert." });
        return;
      }
      const result = `task${buildPythonAccessPath(path)}`;
      const success = await copyToClipboard(result);
      setMessage(success
        ? { type: "success", text: `Python path copied: ${result}` }
        : { type: "error", text: "Unable to copy Python path." });
    },
    [copyToClipboard]
  );

  const handleCopyJson = useCallback(
    async (value: JSONValue) => {
      try {
        const text =
          typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
        const success = await copyToClipboard(text);
        setMessage(success
          ? { type: "success", text: "JSON fragment copied to clipboard." }
          : { type: "error", text: "Unable to copy JSON fragment." });
      } catch {
        setMessage({ type: "error", text: "Unable to copy JSON fragment." });
      }
    },
    [copyToClipboard]
  );

  const handleCopyCode = useCallback(async () => {
    if (!pythonCode.trim()) return;
    const success = await copyToClipboard(pythonCode);
    if (success) {
      setCodeStatus("Copied!");
      setMessage({ type: "success", text: "Python snippet copied to clipboard." });
      window.setTimeout(() => setCodeStatus(""), 2000);
    } else {
      setMessage({ type: "error", text: "Unable to copy Python snippet." });
    }
  }, [pythonCode, copyToClipboard]);

  const selectedEntries = useMemo(
    () => Array.from(selectedFields.entries()),
    [selectedFields]
  );

  const hasPythonCode = pythonCode.trim().length > 0;

  return (
    <div className="app-shell" aria-busy={isLoading}>
      <div className="card">
        {isLoading && (
          <div className="loading-overlay" role="status" aria-live="polite">
            <div className="spinner" />
            <div className="loading-text">Loading JSON&hellip;</div>
          </div>
        )}
        <header className="header">
          <h1>JSON Explorer</h1>
          <p>Upload, inspect, and extract JSON payloads directly into Pandas.</p>
        </header>

        <section className="input-section">
          <div className="input-row">
            <div
              className={`file-input-wrapper${isDragging ? " drag-active" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                id="file-input"
                type="file"
                accept=".json,application/json"
                className="file-input"
                onChange={handleFileUpload}
                disabled={isLoading}
              />
              <label htmlFor="file-input" className="file-input-label">
                Click to upload JSON or drag &amp; drop a file
              </label>
            </div>
            <button type="button" className="button" onClick={handleLoadSample} disabled={isLoading}>
              Load Sample
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
              placeholder="Search in JSON structure..."
              value={searchTerm}
              onChange={handleSearchChange}
              disabled={isLoading}
            />
            <button type="button" className="button" onClick={handleParse} disabled={isLoading}>
              Parse JSON
            </button>
            <button type="button" className="button button-secondary" onClick={handleClearSelections} disabled={isLoading}>
              Remove All
            </button>
            {jsonData && (
              <>
                <button type="button" className="button button-secondary" onClick={handleCollapseAll} disabled={isLoading}>
                  Collapse All
                </button>
                <button type="button" className="button button-secondary" onClick={handleExpandAll} disabled={isLoading}>
                  Expand All
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
            <div className="json-tree" role="tree">
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
                    &times;
                  </button>
                </div>
              ))}
            </div>

            <PythonCodePreview code={hasPythonCode ? pythonCode : ""} />
          </div>
        </section>
      </div>
    </div>
  );
}
