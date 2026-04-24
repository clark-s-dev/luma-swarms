# Move CompanyRail → Top-Bar Workspace Switcher

**Branch:** `sidebar-refactor` (continuation)
**Reference:** Luma console UI — workspace switcher lives in top header as a dropdown button (`<logo> / <workspace ▾> / <breadcrumb>`), not as a 72px left rail.

## Goal

Eliminate the 72px `CompanyRail` left column. Replace it with a horizontal **workspace switcher** dropdown placed at the start of the top breadcrumb bar. Every button remains functional.

## What changes

### New component `WorkspaceSwitcher.tsx`
- Trigger: `<Button variant="ghost" size="sm">` showing current company avatar + name + chevron
- Dropdown content via `DropdownMenu`:
  - Sortable list of all companies (reuse dnd-kit logic from `CompanyRail`)
  - Each item: avatar + name, live-agents pulse dot, unread-inbox red dot
  - Selected item gets accent bg
  - Separator + "Add company" menu item (invokes `openOnboarding()`)
- Preserves: `setSelectedCompanyId`, dnd reorder via `useCompanyOrder`, live-runs + sidebar-badges queries

### `Layout.tsx`
- Remove both `<CompanyRail />` usages (mobile and desktop branches)
- Shrink the left column: mobile drawer just `Sidebar`; desktop just `Sidebar`'s width

### `BreadcrumbBar.tsx`
- Insert `<WorkspaceSwitcher />` immediately after the mobile menu toggle in all three render branches (empty/single/multi breadcrumb). Wrap with a separator slash to match the reference.

## What stays the same

- `Sidebar.tsx` top bar (keeps its existing `SidebarCompanyMenu` dropdown — a different, menu-actions dropdown). Optional follow-up: consolidate both dropdowns; out of scope for this change.
- `SidebarAccountMenu` footer (unchanged)
- `CompanyPatternIcon` (reused inside switcher items)
- Mobile sidebar auto-close behavior

## Risks

- DnD in a dropdown menu: Radix `DropdownMenuItem`s intercept pointer events for focus/selection. Wrap each company row in a plain button inside the menu (or use a custom list not tied to `DropdownMenuItem`) so dnd-kit listeners work. Mitigation: render as a `div` list inside `DropdownMenuContent`, not as `DropdownMenuItem`.
- Keyboard nav: if we bypass `DropdownMenuItem`, we lose arrow-key navigation. Acceptable for v1.
- Selection pill: dropped (was a left-side animated pill on the rail). Replaced with `bg-accent` on the selected row in the dropdown.

## Verification

- `pnpm --filter @paperclipai/ui typecheck`
- Click-through: switcher opens, shows companies, clicking switches, Add company opens onboarding, live/unread dots render, DnD reorder persists.
