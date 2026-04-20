import { useCallback, useMemo } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation, useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { cn } from "../lib/utils";
import { queryKeys } from "../lib/queryKeys";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { heartbeatsApi } from "../api/heartbeats";
import { authApi } from "../api/auth";
import { useCompanyOrder } from "../hooks/useCompanyOrder";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CompanyPatternIcon } from "./CompanyPatternIcon";
import type { Company } from "@paperclipai/shared";

function SortableCompanyRow({
  company,
  isSelected,
  hasLiveAgents,
  hasUnreadInbox,
  onSelect,
}: {
  company: Company;
  isSelected: boolean;
  hasLiveAgents: boolean;
  hasUnreadInbox: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: company.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        type="button"
        onClick={(e) => {
          if (isDragging) {
            e.preventDefault();
            return;
          }
          onSelect();
        }}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
          isSelected ? "bg-accent text-foreground" : "hover:bg-accent/60 text-foreground/90",
        )}
      >
        <span className="relative shrink-0">
          <CompanyPatternIcon
            companyName={company.name}
            logoUrl={company.logoUrl}
            brandColor={company.brandColor}
            className="h-7 w-7 rounded-md text-xs"
          />
          {hasLiveAgents && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-blue-400 opacity-80" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500 ring-2 ring-background" />
              </span>
            </span>
          )}
          {hasUnreadInbox && (
            <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{company.name}</span>
      </button>
    </div>
  );
}

export function WorkspaceSwitcher() {
  const { companies, selectedCompany, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openOnboarding } = useDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const isInstanceRoute = location.pathname.startsWith("/instance/");
  const highlightedCompanyId = isInstanceRoute ? null : selectedCompanyId;

  const visibleCompanies = useMemo(
    () => companies.filter((c) => c.status !== "archived"),
    [companies],
  );

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  const companyIds = useMemo(() => visibleCompanies.map((c) => c.id), [visibleCompanies]);

  const liveRunsQueries = useQueries({
    queries: companyIds.map((companyId) => ({
      queryKey: queryKeys.liveRuns(companyId),
      queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
      refetchInterval: 10_000,
    })),
  });
  const sidebarBadgeQueries = useQueries({
    queries: companyIds.map((companyId) => ({
      queryKey: queryKeys.sidebarBadges(companyId),
      queryFn: () => sidebarBadgesApi.get(companyId),
      refetchInterval: 15_000,
    })),
  });
  const hasLiveAgentsByCompanyId = useMemo(() => {
    const result = new Map<string, boolean>();
    companyIds.forEach((companyId, index) => {
      result.set(companyId, (liveRunsQueries[index]?.data?.length ?? 0) > 0);
    });
    return result;
  }, [companyIds, liveRunsQueries]);
  const hasUnreadInboxByCompanyId = useMemo(() => {
    const result = new Map<string, boolean>();
    companyIds.forEach((companyId, index) => {
      result.set(companyId, (sidebarBadgeQueries[index]?.data?.inbox ?? 0) > 0);
    });
    return result;
  }, [companyIds, sidebarBadgeQueries]);

  const { orderedCompanies, persistOrder } = useCompanyOrder({
    companies: visibleCompanies,
    userId: currentUserId,
  });

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = orderedCompanies.map((c) => c.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedCompanies, persistOrder],
  );

  const triggerCompany = selectedCompany ?? orderedCompanies[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2 rounded-md px-2 data-[state=open]:bg-muted"
          aria-label="Switch workspace"
        >
          {triggerCompany ? (
            <CompanyPatternIcon
              companyName={triggerCompany.name}
              logoUrl={triggerCompany.logoUrl}
              brandColor={triggerCompany.brandColor}
              className="size-5 rounded-full text-[10px]"
            />
          ) : null}
          <span className="max-w-48 truncate text-sm font-medium">
            {triggerCompany?.name ?? "Select workspace"}
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-64 p-1"
      >
        <div className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
          Workspaces
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedCompanies.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {orderedCompanies.map((company) => (
                <SortableCompanyRow
                  key={company.id}
                  company={company}
                  isSelected={company.id === highlightedCompanyId}
                  hasLiveAgents={hasLiveAgentsByCompanyId.get(company.id) ?? false}
                  hasUnreadInbox={hasUnreadInboxByCompanyId.get(company.id) ?? false}
                  onSelect={() => {
                    setSelectedCompanyId(company.id);
                    if (isInstanceRoute) {
                      navigate(`/${company.issuePrefix}/dashboard`);
                    }
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <DropdownMenuSeparator />
        <button
          type="button"
          onClick={() => openOnboarding()}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
            <Plus className="h-3.5 w-3.5" />
          </span>
          Add workspace
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
