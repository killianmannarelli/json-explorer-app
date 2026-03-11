import { memo, useMemo, useCallback, KeyboardEvent } from "react";
import type { JSONValue, JSONObject, JSONArray, Path } from "../types";
import { getJsonType, formatValue } from "../utils/json";

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
  if (isSelectedValue) nodeContentClasses.push("selected");
  if (matchesSearch) nodeContentClasses.push("highlight");

  const nodeValueClasses = ["node-value"];
  if (isSelectedValue) nodeValueClasses.push("selected");

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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "Enter":
        case " ":
          event.preventDefault();
          if (isExpandable) {
            onToggleExpand(pathKey);
          } else {
            onSelectValue(path);
          }
          break;
        case "ArrowRight":
          if (isExpandable && !isExpanded) {
            event.preventDefault();
            onToggleExpand(pathKey);
          }
          break;
        case "ArrowLeft":
          if (isExpandable && isExpanded) {
            event.preventDefault();
            onToggleExpand(pathKey);
          }
          break;
        case "ArrowDown": {
          event.preventDefault();
          const next = (event.currentTarget as HTMLElement)
            .closest(".tree-node")
            ?.querySelector(".children .tree-node .node-content") as HTMLElement | null;
          if (next) {
            next.focus();
          } else {
            const sibling = (event.currentTarget as HTMLElement)
              .closest(".tree-node")
              ?.nextElementSibling
              ?.querySelector(".node-content") as HTMLElement | null;
            sibling?.focus();
          }
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prev = (event.currentTarget as HTMLElement)
            .closest(".tree-node")
            ?.previousElementSibling
            ?.querySelector(".node-content") as HTMLElement | null;
          prev?.focus();
          break;
        }
      }
    },
    [isExpandable, isExpanded, pathKey, path, onToggleExpand, onSelectValue]
  );

  return (
    <div className="tree-node" style={{ marginLeft: level === 0 ? 0 : 12 }}>
      <div
        className={nodeContentClasses.join(" ")}
        tabIndex={0}
        role="treeitem"
        aria-expanded={isExpandable ? isExpanded : undefined}
        onKeyDown={handleKeyDown}
      >
        {isExpandable ? (
          <button
            type="button"
            className={`expand-btn ${isExpanded ? "expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand(pathKey);
            }}
            tabIndex={-1}
            aria-label={isExpanded ? "Collapse" : "Expand"}
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
              tabIndex={-1}
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
              tabIndex={-1}
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
            tabIndex={-1}
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
            tabIndex={-1}
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
              tabIndex={-1}
            >
              Copy JSON
            </button>
          )}
        </div>
      </div>

      {isExpandable && isExpanded && childrenToRender && (
        <div className="children" role="group">
          {type === "object" && childrenToRender.entries && (
            <>
              {childrenToRender.entries.map(([childKey, childValue]) => (
                <MemoTreeNode
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
                <MemoTreeNode
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

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

const MemoTreeNode = memo(TreeNode, (prev, next) => {
  if (prev.value !== next.value) return false;
  if (prev.label !== next.label) return false;
  if (prev.level !== next.level) return false;
  if (prev.searchTerm !== next.searchTerm) return false;
  if (prev.maxChildrenToShow !== next.maxChildrenToShow) return false;
  if (prev.path !== next.path && JSON.stringify(prev.path) !== JSON.stringify(next.path)) return false;
  if (!areSetsEqual(prev.expandedPaths, next.expandedPaths)) return false;
  if (!areSetsEqual(prev.selectedValueKeys, next.selectedValueKeys)) return false;
  if (prev.onToggleExpand !== next.onToggleExpand) return false;
  if (prev.onSelectValue !== next.onSelectValue) return false;
  if (prev.onSelectSubtree !== next.onSelectSubtree) return false;
  if (prev.onCopyPath !== next.onCopyPath) return false;
  if (prev.onCopyPython !== next.onCopyPython) return false;
  if (prev.onCopyJson !== next.onCopyJson) return false;
  return true;
});

export default MemoTreeNode;
