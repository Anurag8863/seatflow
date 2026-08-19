import { NavLink } from 'react-router-dom';
import {
  Building2,
  LayoutDashboard,
  Map,
  Settings,
  Sparkles,
  Users,
  Armchair,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/seating-plan', label: 'Seating Plan', icon: Map, end: false },
  { to: '/employees', label: 'Employees', icon: Users, end: false },
  { to: '/seats', label: 'Seats', icon: Armchair, end: false },
  { to: '/ai-assistant', label: 'AI Assistant', icon: Sparkles, end: false },
  { to: '/activity', label: 'Activity', icon: History, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Building2 className="size-4" aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">SeatFlow</span>
    </div>
  );
}

interface SidebarNavProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={cn('size-4 shrink-0', isActive && 'text-primary')} aria-hidden="true" />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function DesktopSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-14 items-center border-b border-border px-5">
        <SidebarBrand />
      </div>
      <SidebarNav />
      <div className="border-t border-border px-5 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          SeatFlow · Workplace operations
        </p>
      </div>
    </aside>
  );
}
