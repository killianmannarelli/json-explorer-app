# JSON Explorer

A browser-based tool for exploring JSON payloads and generating Python (pandas) extraction snippets. Paste or upload any JSON, visually browse its tree structure, select fields, and get ready-to-use `transform()` functions for your DataFrame pipelines.

## Features

- **Tree view** — Expandable/collapsible JSON tree with type badges, search highlighting, and keyboard navigation
- **Field selection** — Click any leaf value to add it to the extraction set; click an object/array to add all its children at once
- **Python code generation** — Generates a pandas `transform(df)` function that safely extracts your selected fields from a JSON column
- **Copy helpers** — One-click copy for dot-notation paths, Python access paths, JSON fragments, and the full generated snippet
- **File upload & drag-and-drop** — Load JSON from a file or drag it onto the upload area
- **Dark mode** — Automatically follows system preference
- **Large payload handling** — Adaptive expand depth and child-count limits for payloads with thousands of nodes

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Project Structure

```
src/app/
├── types.ts                 # Shared TypeScript types
├── utils/
│   ├── json.ts              # JSON traversal, path utilities, tree helpers
│   └── python.ts            # Python code generation
├── components/
│   ├── TreeNode.tsx          # Recursive tree node with memoization
│   └── PythonCodePreview.tsx # Syntax-highlighted Python output
├── page.tsx                  # Main page component and state
├── layout.tsx                # Root layout with fonts and metadata
└── globals.css               # All application styles (light + dark)
```

## Tech Stack

- [Next.js 16](https://nextjs.org/) (App Router)
- [React 19](https://react.dev/)
- TypeScript

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | Run ESLint |
