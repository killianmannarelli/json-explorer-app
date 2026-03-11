import type { Path, FieldSelection } from "../types";

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

export function generatePythonCode(
  selections: Map<string, FieldSelection>,
  columnName: string
): string {
  if (selections.size === 0) {
    return "";
  }
  return buildSimplePythonCode(Array.from(selections.values()), columnName);
}

export function buildPythonAccessPath(path: Path): string {
  return path
    .map((segment) =>
      typeof segment === "number" ? `[${segment}]` : `["${segment}"]`
    )
    .join("");
}
