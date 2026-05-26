---
name: to-html
description: Generate a self-contained static HTML page from conversation context with a clean, minimal design system. Use when the user wants to turn discussion results, investigation findings, code reviews, or reports into a browser-friendly HTML document. Triggered by phrases like "turn into html", "generate a report", "make a page", "present as html".
disable-model-invocation: true
---

# to-html

Convert conversation context into a self-contained static HTML page using Tailwind CSS and the Clean design system.

## Quick start

User invokes `/skill:to-html summarize these findings as a report`. The skill:

1. Reads the user's instruction after `/skill:to-html`.
2. Uses the full conversation history as source material.
3. Generates a single self-contained `.html` file via the `write` tool.
4. Reports the file path so the user can open it in a browser.

## Workflow

### 1. Determine the filename

Slugify the user's prompt:

- Lowercase, replace non-alphanumeric chars with hyphens, collapse consecutive hyphens, trim leading/trailing hyphens.
- Truncate to ~60 characters, append `.html`.
- Fallback: `to-html-output.html` if the slug is empty.

Example: `turn this investigation into a report` → `turn-this-investigation-into-a-report.html`

### 2. Produce the HTML

Generate complete, self-contained HTML with Tailwind CSS via CDN:

```html
<script src="https://cdn.tailwindcss.com"></script>
```

No other CDN links, external fonts, or JavaScript libraries. All additional CSS must be inline in a `<style>` tag.

Start every page with this skeleton:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page Title</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-gray-50 text-gray-900 font-sans antialiased">
    <main class="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-8">Page Title</h1>
      <!-- Content sections here -->
    </main>
  </body>
</html>
```

### 3. Structure the content

- Use `<h1>` for the page title (derived from the prompt).
- Use semantic elements: `<section>`, `<article>`, `<header>`, `<footer>`.
- Structure with clear hierarchy: headline → support text → primary content.
- Separate concerns with whitespace before adding borders or shadows.

### 4. Save and report

Use the `write` tool to save the file to the current working directory. After saving, tell the user the full path.

## Design system

See [REFERENCE.md](./REFERENCE.md) for the complete Clean design system with colors, typography, spacing, components, motion, and anti-patterns. Apply these tokens with Tailwind utility classes — avoid custom CSS unless Tailwind cannot express the design.
