# shadcn `radix-luma` Preset Integration

**Branch:** `shadcn-integration`
**Preset:** `b1GwQVriS` → shadcn style `radix-luma`
**Install command (reference, NOT to run verbatim):** `pnpm dlx shadcn@latest init --preset b1GwQVriS --template next`
**Target:** `ui/` (Vite, not Next — so we adapt, not run `init`)

## What the preset changes

Two things, not just tokens:

1. **Theme tokens** (`ui/src/index.css`)
   - `--radius`: `0` → `0.45rem`
   - Extended radius scale: adds `--radius-2xl/3xl/4xl` (computed from `--radius`)
   - Chart colors: flipped to amber/yellow/orange palette
   - Dark-mode borders use alpha (`oklch(1 0 0 / 10%)`) instead of solid
   - Adds `--font-heading` and `--font-sans` CSS vars
   - Adds base layer: `outline-ring/50` on `*`, `font-sans` on `html`
   - Requires new imports: `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`

2. **Component implementations** (`ui/src/components/ui/*.tsx`)
   - All components rewritten (radix-luma is a new style, like swapping `new-york` → something else)
   - Example: `Button` uses `rounded-4xl`, softer `bg-destructive/10`, different variant classes
   - Requires radius scale and base layer from token changes above

## Font

Replace all `font-sans` usage with **Nunito Sans**. Vite equivalent of the Next preset's `next/font/google` wiring:
- Add Google Fonts `<link>` to `ui/index.html`
- Set `--font-sans: 'Nunito Sans', ui-sans-serif, system-ui, ...` in `:root`

## Plan (5 steps, each revertable via git)

1. **Update `ui/components.json`** — `style: "new-york"` → `style: "radix-luma"`
2. **Install deps** — `pnpm -F @paperclipai/ui add shadcn tw-animate-css` (or wherever `ui/package.json` lives)
3. **Patch `ui/src/index.css`**
   - Add `@import "tw-animate-css"` and `@import "shadcn/tailwind.css"` after the tailwind import
   - Replace `@theme inline { ... }` block with preset's (includes new radius scale + `--font-heading/--font-sans`)
   - Replace `:root` block with preset's (adds `--radius: 0.45rem`, new chart colors)
   - Replace `.dark` block with preset's (alpha borders, new chart colors)
   - Extend base layer with `outline-ring/50` and `html { @apply font-sans }`
   - **Preserve** everything else (MDXEditor, markdown, shimmer, scrollbars, activity animations)
4. **Wire Nunito Sans**
   - Add Google Fonts preconnect + `<link>` to `ui/index.html`
   - Override `--font-sans` in `:root` to use `'Nunito Sans'`
5. **Reinstall all components with overwrite**
   - `cd ui && pnpm dlx shadcn@latest add --all --overwrite`
   - Rewrites all 21 existing + adds remaining registry components

## Risks

### High — will change behavior
- **Step 5 wipes local component edits.** Any project-specific tweaks to files under `ui/src/components/ui/` are replaced with stock radix-luma versions. Diff `git status` after step 5 and re-apply deliberate customizations.
- **Consumer code breaks** if a `variant=` or prop used in app code doesn't exist in the radix-luma component. TypeScript will surface this in `pnpm typecheck`.
- **Radius becomes rounded everywhere** (`0` → `0.45rem`). Every card/button/input/dialog visibly changes.

### Medium — subtle
- Alpha-based dark borders can look thin or doubled in specific stacking contexts.
- `rounded-xl` etc. change meaning because `--radius-xl` is now `calc(var(--radius) * 1.4)` instead of `0px`.
- Chart colors change palette. Any screenshot tests, brand expectations fail.
- Nunito Sans metrics differ from system-ui — tight one-line layouts may wrap differently.

### Low
- Existing custom CSS (MDXEditor, markdown, mermaid, animations) keeps working: it references `--foreground`/`--border`/etc. by name, and we only change values.
- New deps `shadcn` + `tw-animate-css` are small.

## Mitigations

- Run on isolated branch (`shadcn-integration`) — revert any step with `git checkout -- <file>`.
- `pnpm typecheck` after step 5 catches variant/prop mismatches.
- Start `pnpm dev`, visually inspect golden paths before merging to `master`.
- If step 5 is too disruptive, **skip it** and ship tokens + font only. Result is imperfect (new-york components under radix-luma tokens) but nothing breaks; migrate components incrementally.

## Decision log

- **2026-04-19** — Spec written. Awaiting user decision: full 5-step vs tokens+font only (skip step 5).
- **2026-04-19** — User chose full 5-step. Implemented on branch `shadcn-integration`.
  - 56 components in `ui/src/components/ui/` (22 rewritten, 34 new, 1 preserved: `toggle-switch.tsx`).
  - Typecheck broke at 2 sites; both fixed:
    - `Identity.tsx` — mapped Avatar `size="xs"` to new component's `sm` + explicit `size-5` override (new Avatar only supports `default|sm|lg`).
    - `ui/popover.tsx` — re-added `disablePortal` prop (removed in radix-luma default); `InlineEntitySelector` relies on it.
  - Nunito Sans loaded via Google Fonts `<link>` in `ui/index.html`; `--font-sans` set in `:root`.
  - Existing custom CSS (MDXEditor, markdown, shimmer, scrollbars, activity animations) preserved.
  - Dev server on :3100 healthy; no CSS compile errors. Full visual pass still pending.

## References

- Generated preset output in scratch dir: `/tmp/shadcn-probe/probe-app/` (Next.js reference artifacts — globals.css, components.json, layout.tsx with Nunito Sans wiring)
