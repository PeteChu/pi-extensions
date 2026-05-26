# Clean Design System Reference

Apply these tokens with Tailwind utility classes. Avoid custom CSS unless Tailwind cannot express the design.

## Colors

| Token     | Hex       | Tailwind     | Usage                                    |
| --------- | --------- | ------------ | ---------------------------------------- |
| Primary   | `#3B82F6` | `blue-500`   | CTA emphasis, links, interactive accents |
| Secondary | `#8B5CF6` | `violet-500` | Secondary accents                        |
| Success   | `#16A34A` | `green-600`  | Positive indicators                      |
| Warning   | `#D97706` | `amber-600`  | Cautions                                 |
| Danger    | `#DC2626` | `red-600`    | Errors, destructive actions              |
| Surface   | `#FFFFFF` | `white`      | Large backgrounds, cards                 |
| Text      | `#111827` | `gray-900`   | Body copy                                |

Favor primary for CTA emphasis. Use surface for large backgrounds and cards. Keep body copy on text color for legibility.

## Typography

- Body: `font-sans` (system stack). Code: `font-mono`.
- Scale: `text-xs` (12), `text-sm` (14), `text-base` (16), `text-xl` (20), `text-2xl` (24), `text-3xl` (32).
- Headings carry visual hierarchy; body text optimizes scanability and contrast.
- Never flatten hierarchy by using the same type size/weight for all text.

## Spacing & Layout

- Use Tailwind spacing scale (`p-4`, `p-6`, `p-8`, `gap-4`, etc.). Prefer multiples of 2 (8pt grid).
- Keep vertical rhythm consistent across sections.
- Constrain content width: `max-w-3xl mx-auto`.
- Pad body: `p-4 sm:p-6 lg:p-8`.

## Components

### Buttons

- **Primary:** `bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors duration-150`
- **Secondary:** `bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded transition-colors duration-150`

### Cards / Sections

```
bg-white rounded-lg shadow-sm border border-gray-100 p-6
```

Consistent radii and spacing across all cards.

### Code blocks

```
<pre class="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto"><code>...</code></pre>
```

### Tables

- Container: `w-full border-collapse`
- Rows: `border-b border-gray-200`
- Cells: `text-left p-3`
- Header: `bg-gray-50 font-medium`

## States

- **Focus:** `focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`
- **Hover:** Always define a hover state for interactive elements.
- **Disabled:** `opacity-50 cursor-not-allowed`

## Motion

- Use `transition-colors duration-150` for interactive elements.
- Subtle transitions that emphasize primary as the interaction signal.
- 150-250ms range with stable easing.

## Anti-patterns

- Do not introduce colors outside the defined palette.
- Do not flatten hierarchy by using the same type size/weight everywhere.
- Do not add decorative effects that reduce readability.
- Do not mix unrelated visual metaphors.
- Do not use Tailwind `prose` or typography plugin — write explicit utility classes.
- Do not use off-palette colors when an existing token can solve the problem.
