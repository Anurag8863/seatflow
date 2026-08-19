import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Building2, ChevronDown, LogOut, Menu, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import type { AuditLog } from '@/lib/types';
import { auditActionLabel, formatSmartDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkspace } from '@/providers/WorkspaceProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/misc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GlobalSearch } from './GlobalSearch';

function FloorSelector() {
  const { buildings, building, floor, setBuilding, setFloor, isLoading } = useWorkspace();

  if (isLoading || !building || !floor) {
    return <div className="hidden h-9 w-44 animate-pulse rounded-md bg-muted md:block" aria-hidden="true" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="hidden h-9 max-w-[15rem] md:inline-flex">
          <Building2 aria-hidden="true" />
          <span className="truncate">
            {building.code} · {floor.name}
          </span>
          <ChevronDown className="opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {buildings.map((item) => (
          <React.Fragment key={item.id}>
            <DropdownMenuLabel className="flex items-center justify-between gap-2">
              <span className="truncate normal-case tracking-normal">{item.name}</span>
              {item.id === building.id ? <span className="text-[10px] text-primary">Current</span> : null}
            </DropdownMenuLabel>
            {item.floors.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => {
                  if (item.id !== building.id) setBuilding(item.id);
                  setFloor(entry.id);
                }}
                className={cn(entry.id === floor.id && 'bg-accent text-accent-foreground')}
              >
                <span className="flex-1 truncate">{entry.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {entry.occupiedCount}/{entry.seatCount}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="last:hidden" />
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationsMenu() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', 'recent'],
    queryFn: async () => (await api.get<AuditLog[]>('/audit-logs', { page: 1, pageSize: 6 })).data,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const count = data?.length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={'Recent activity' + (count ? ', ' + count + ' items' : '')}>
          <span className="relative">
            <Bell aria-hidden="true" />
            {count > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-card" />
            ) : null}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Recent activity</p>
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin py-1">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : count === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No seating activity yet.</p>
          ) : (
            data?.map((log) => (
              <button
                key={log.id}
                type="button"
                onClick={() => navigate('/activity')}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{auditActionLabel(log.action)}</span>
                  {log.source === 'AI' ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">AI</span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{log.summary}</span>
                <span className="text-[11px] text-muted-foreground/80">{formatSmartDate(log.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const Icon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Change theme">
              <Icon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme: {theme}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => setTheme('light')} className={cn(theme === 'light' && 'bg-accent')}>
          <Sun aria-hidden="true" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')} className={cn(theme === 'dark' && 'bg-accent')}>
          <Moon aria-hidden="true" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')} className={cn(theme === 'system' && 'bg-accent')}>
          <Monitor aria-hidden="true" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu" className="rounded-full">
          <Avatar name={user.name} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <p className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {user.role}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <UserRound aria-hidden="true" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
        >
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar} aria-label="Open navigation">
        <Menu aria-hidden="true" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FloorSelector />
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <NotificationsMenu />
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
