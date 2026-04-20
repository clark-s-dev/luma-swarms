# Sidebar Refactor — shadcn components & unified Button surface

**Status:** draft — ready for review
**Branch:** `sidebar-refactor`
**Authors:** yuqings, Claude
**Depends on:** shadcn radix-luma integration (merged 2026-04-20)

## Goal

Refactor every sidebar/nav surface to use shadcn components. Every interactive element becomes `<Button>` (or a shadcn primitive that composes it) with its existing behavior preserved. No handler regressions: every click today must click tomorrow, to the same target.

## Non-goals (v1)

- **Adopting `<SidebarProvider>` / `<Sidebar>` wrapper components.** They bring their own width/collapse/mobile-drawer state machine and CSS variables. Rewiring the existing layout, the `SidebarContext`, and `CompanyRail` to that system is a much bigger blast radius. v1 keeps the current shell layout and only replaces internals.
- Visual redesign. Paddings, colors, widths stay the same. Only element type changes.
- Mobile bottom nav (`MobileBottomNav.tsx`) — not a sidebar; defer to a follow-up.
- Adding new features (search modal redesign, new shortcuts). Pure mechanical refactor.

## Scope — files touched

Primary sidebar stack:
- `ui/src/components/Sidebar.tsx`
- `ui/src/components/SidebarNavItem.tsx`
- `ui/src/components/SidebarSection.tsx`
- `ui/src/components/SidebarCompanyMenu.tsx`
- `ui/src/components/SidebarAccountMenu.tsx`
- `ui/src/components/SidebarProjects.tsx`
- `ui/src/components/SidebarAgents.tsx`

Contextual sidebars:
- `ui/src/components/CompanySettingsSidebar.tsx`
- `ui/src/components/InstanceSidebar.tsx`

Company rail:
- `ui/src/components/CompanyRail.tsx`

## Component mapping

| Current element | File:line | Replace with | Variant / size | Notes |
|---|---|---|---|---|
| Search `<Button>` (ghost icon) | `Sidebar.tsx:55–62` | `<Button>` | `variant="ghost" size="icon"` | Already shadcn — only adjust `size` to new API (`icon-sm` → `icon`). |
| "New Issue" native `<button>` | `Sidebar.tsx:68–74` | `<Button>` | `variant="ghost" size="icon"` | Preserve `openNewIssue()` via DialogContext. |
| `SidebarNavItem` NavLink | `SidebarNavItem.tsx:37–92` | `<Button asChild><NavLink>` | `variant="ghost"` | Keep NavLink for routing; wrap so active-state styling flows through shadcn. Badge + alert dot render as children. |
| Company menu trigger | `SidebarCompanyMenu.tsx:47` | `<Button>` (unchanged) | `variant="ghost"` | Already shadcn. |
| Invite / Settings / Sign out menu items | `SidebarCompanyMenu.tsx:73–96` | `<DropdownMenuItem>` | `variant="destructive"` on Sign out | Already shadcn — verify radix-luma styling didn't change the `asChild` pattern. |
| Account menu trigger native `<button>` | `SidebarAccountMenu.tsx:125–135` | `<Button asChild>` | `variant="ghost"` | Wraps avatar + name children. |
| Edit profile / Instance settings / Docs | `SidebarAccountMenu.tsx:167–188` | `<Button asChild><Link>` / `<a>` | `variant="ghost"` | All routed via existing handlers. |
| Theme toggle native `<button>` | `SidebarAccountMenu.tsx:189–197` | `<Button>` | `variant="ghost"` | Preserve `toggleTheme()` from ThemeContext; icon swaps Sun/Moon. |
| Sign out native `<button>` | `SidebarAccountMenu.tsx:199–220` | `<Button>` | `variant="destructive"` | Preserve `signOutMutation.mutate()`; show disabled state while mutation pending. |
| Projects collapse trigger | `SidebarProjects.tsx:187–197` | `<CollapsibleTrigger asChild><Button>` | `variant="ghost" size="sm"` | Keeps chevron rotation. |
| "New project" native `<button>` | `SidebarProjects.tsx:198–207` | `<Button>` | `variant="ghost" size="icon"` | Preserve `openNewProject()`. |
| Project item NavLink | `SidebarProjects.tsx:222–233` | `<Button asChild><NavLink>` | `variant="ghost"` | DnD listeners stay on the sortable wrapper, not the Button. |
| Agents collapse trigger | `SidebarAgents.tsx:77–87` | `<CollapsibleTrigger asChild><Button>` | `variant="ghost" size="sm"` | Same pattern as projects. |
| "New agent" native `<button>` | `SidebarAgents.tsx:88–97` | `<Button>` | `variant="ghost" size="icon"` | Preserve `openNewAgent()`. |
| Agent item NavLink | `SidebarAgents.tsx:106–140` | `<Button asChild><NavLink>` | `variant="ghost"` | Live-count indicator + budget marker stay as children. |
| Back link in settings | `CompanySettingsSidebar.tsx:36–45` | `<Button asChild><Link>` | `variant="ghost" size="sm"` | Preserve `closeMobileSidebar()` side effect. |
| Company rail items (anchor+click) | `CompanyRail.tsx:219–233` | `<Button asChild><a>` within existing `<Tooltip>` | `variant="ghost" size="icon"` | Preserve `onSelect()` handler, drag listeners on sortable wrapper. Selection pill animation left intact. |
| "Add company" native `<button>` | `CompanyRail.tsx:245–257` | `<Button>` | `variant="outline" size="icon"` | Add `border-dashed` utility class to preserve dashed look; preserve `openOnboarding()`. |

## Handlers & state that MUST keep working (acceptance checklist)

Every item below is a click-through test to run before merging:

1. **Search button** → opens global `Cmd+K` modal via synthetic keydown dispatch.
2. **New Issue** → `openNewIssue()` opens the issue dialog (DialogContext).
3. **Dashboard / Inbox / Plugin nav items** → React Router navigation, active-state correct, badges render (inbox unread count, liveRuns on dashboard).
4. **Mobile sidebar auto-close** on nav item click (via `SidebarContext.closeSidebar()` inside `SidebarNavItem`).
5. **Company menu** → opens dropdown, "Invite people" routes to `/company/settings/invites`, "Company settings" routes to `/company/settings`, "Sign out" triggers `signOutMutation.mutate()` and shows "Signing out..." while pending.
6. **Account menu** → opens popover, Edit profile / Instance settings / Docs route correctly (Docs opens external in new tab), theme toggle flips light/dark and updates ThemeContext, sign-out runs mutation.
7. **Projects collapse** → expand/collapse persists via existing local state; chevron rotates.
8. **New project button** → `openNewProject()`.
9. **Project items** → navigate to `/projects/:routeRef/issues`; drag reorder still works via dnd-kit (8px activation constraint).
10. **Agents collapse + New agent + item navigation + live-count indicator + budget marker + DnD reorder** — same as projects.
11. **Company Settings back link** → `/dashboard`, closes mobile sidebar.
12. **Company Settings / Instance Settings** nav items route correctly, badges (join requests) render.
13. **Instance Settings plugin sub-items** render and route to `/instance/settings/plugins/:id`.
14. **Company rail** — clicking a company sets `selectedCompanyId` via CompanyContext and conditionally navigates; drag reorder works; unread/live indicators render; selection pill animates on change; tooltip still shows company name.
15. **Add company** → `openOnboarding()`.

## Implementation strategy

### Step 1 — `SidebarNavItem` wrapping pattern
Introduce a single helper so every nav item gets consistent `<Button asChild><NavLink>` composition. Extract into `SidebarNavItem.tsx` itself; callers don't change.

### Step 2 — Replace native `<button>` call sites
Mechanical swap, one file at a time. Commit per file so regressions are bisectable.

### Step 3 — Audit `SidebarCompanyMenu` for radix-luma style regressions
Radix-luma changed `DropdownMenu` styling. Confirm destructive variant still renders correctly after the preset merge; the Button underneath it gets the new radix-luma skin automatically.

### Step 4 — Preserve dnd-kit behavior
The sortable wrapper (`useSortable`) attaches `listeners` to a spread target. When we change the inner element to `<Button asChild>`, spread listeners onto the *outer* `<li>`/`<div>` wrapper, **not** the Button itself — otherwise keyboard/mouse activation on the Button would compete with drag activation. This is the one non-trivial risk.

### Step 5 — Verification pass
- `pnpm --filter @paperclipai/ui typecheck`
- `pnpm dev`, manually click every item in the acceptance checklist above
- Test light + dark mode
- Test mobile layout (sidebar drawer, nav item auto-close)

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| DnD listeners on the wrong element break drag after refactor | Medium | Always attach listeners to outer wrapper, never Button. |
| `<Button asChild>` loses `NavLink` active class because radix Slot merges classNames in a specific order | Medium | Verify active styling per item; may need to use `className={({ isActive }) => ...}` NavLink render prop. |
| Radix-luma Button default styling has more padding/different height than the ghost `<button>` today | Low | Override with `size="sm"` or `className="h-8 px-2"` where the old spec was tighter. |
| Icon-only buttons under radix-luma use `rounded-4xl` from the preset — looks too round for a 60px rail | Low | Add `rounded-md` override at the rail-level style. Only need this if visual review fails. |
| Keyboard focus rings change | Low | Radix-luma uses `ring-ring/30`. Visually verify. |

## Phased delivery

- **v1 (this branch, ~1 day):** Steps 1–5 for primary sidebar + company menu + account menu + projects + agents.
- **v1.1:** `CompanySettingsSidebar`, `InstanceSidebar`, `CompanyRail`.
- **v1.2:** `MobileBottomNav` evaluation — either keep custom or swap to Button.

## Out of scope / explicitly deferred

- Adopting `<SidebarProvider>` + `<Sidebar>` top-level wrappers (would replace custom SidebarContext).
- Replacing `SidebarContext` / `CompanyContext` / `DialogContext` with shadcn patterns.
- New features or UX changes.

## Acceptance criteria

1. `pnpm --filter @paperclipai/ui typecheck` passes.
2. Every item in the "Handlers & state" checklist passes manual click-through in both light and dark mode.
3. DnD reorder of projects, agents, and companies still works.
4. Mobile: sidebar opens/closes correctly, nav-item click auto-closes.
5. No new runtime warnings in the browser console.
6. `git grep -n "<button"` in the files above returns zero matches that aren't inside shadcn primitives.

## References

- Audit of current sidebar buttons: inline in this doc, from exploration on 2026-04-20.
- shadcn Button: `ui/src/components/ui/button.tsx`
- shadcn (unused) Sidebar primitives: `ui/src/components/ui/sidebar.tsx` (considered then rejected for v1)
- shadcn radix-luma integration plan: `doc/plans/2026-04-19-shadcn-radix-luma-integration.md`
