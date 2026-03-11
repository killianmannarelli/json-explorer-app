import { useMemo } from "react";

const PYTHON_KEYWORDS = new Set([
  "import", "from", "def", "return", "if", "else", "elif", "for", "in",
  "try", "except", "and", "or", "not", "is", "None", "True", "False",
  "isinstance", "len",
]);

interface Token {
  type: "keyword" | "string" | "comment" | "builtin" | "number" | "plain";
  text: string;
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === "#") {
      tokens.push({ type: "comment", text: line.slice(i) });
      break;
    }

    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      const tripleQuote = line.slice(i, i + 3);
      if (tripleQuote === '"""' || tripleQuote === "'''") {
        const end = line.indexOf(tripleQuote, i + 3);
        if (end !== -1) {
          tokens.push({ type: "string", text: line.slice(i, end + 3) });
          i = end + 3;
        } else {
          tokens.push({ type: "string", text: line.slice(i) });
          break;
        }
      } else {
        let j = i + 1;
        while (j < line.length && line[j] !== quote) {
          if (line[j] === "\\") j++;
          j++;
        }
        tokens.push({ type: "string", text: line.slice(i, j + 1) });
        i = j + 1;
      }
      continue;
    }

    if (/\d/.test(line[i]) && (i === 0 || /[\s,(\[{:=<>+\-*/]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[\d.]/.test(line[j])) j++;
      tokens.push({ type: "number", text: line.slice(i, j) });
      i = j;
      continue;
    }

    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (PYTHON_KEYWORDS.has(word)) {
        tokens.push({ type: "keyword", text: word });
      } else if (j < line.length && line[j] === "(") {
        tokens.push({ type: "builtin", text: word });
      } else {
        tokens.push({ type: "plain", text: word });
      }
      i = j;
      continue;
    }

    let j = i;
    while (j < line.length && !/[a-zA-Z_0-9"'#]/.test(line[j])) j++;
    tokens.push({ type: "plain", text: line.slice(i, j) });
    i = j;
  }

  return tokens;
}

const TOKEN_COLORS: Record<Token["type"], string> = {
  keyword: "#c792ea",
  string: "#c3e88d",
  comment: "#546e7a",
  builtin: "#82aaff",
  number: "#f78c6c",
  plain: "#e2e8f0",
};

interface PythonCodePreviewProps {
  code: string;
}

export default function PythonCodePreview({ code }: PythonCodePreviewProps) {
  const highlighted = useMemo(() => {
    if (!code) return null;
    return code.split("\n").map((line, lineIndex) => {
      const tokens = tokenizeLine(line);
      return (
        <div key={lineIndex}>
          {tokens.map((token, tokenIndex) => (
            <span key={tokenIndex} style={{ color: TOKEN_COLORS[token.type] }}>
              {token.text}
            </span>
          ))}
          {tokens.length === 0 && "\n"}
        </div>
      );
    });
  }, [code]);

  if (!code) {
    return (
      <pre className="code-preview empty">
        Click a value in the JSON tree to generate the transformation snippet.
      </pre>
    );
  }

  return (
    <pre className="code-preview">
      <code>{highlighted}</code>
    </pre>
  );
}
