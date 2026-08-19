import { useQuery } from '@tanstack/react-query';
import { Building2, Cpu, Moon, Monitor, Palette, Sun, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import type { AiStatus, Building } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import { useTheme, type Theme } from '@/providers/ThemeProvider';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, Skeleton } from '@/components/ui/misc';

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun; description: string }> = [
  { value: 'light', label: 'Light', icon: Sun, description: 'Bright surfaces for well-lit rooms.' },
  { value: 'dark', label: 'Dark', icon: Moon, description: 'Low-glare surfaces for dim rooms.' },
  { value: 'system', label: 'System', icon: Monitor, description: 'Follow your operating system.' },
];

export function SettingsPage() {
  const { user } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => (await api.get<AiStatus>('/ai/status')).data,
    staleTime: 10 * 60 * 1000,
  });

  const { data: buildings, isLoading: buildingsLoading } = useQuery({
    queryKey: ['buildings'],
    queryFn: async () => (await api.get<Building[]>('/buildings')).data,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your account, appearance preferences and workspace configuration." />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* -------------------------------------------------------- account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
              Account
            </CardTitle>
            <CardDescription>The administrator account you are signed in with.</CardDescription>
          </CardHeader>
          <CardContent>
            {user ? (
              <div className="flex items-center gap-3.5">
                <Avatar name={user.name} className="size-12 text-sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                  <p className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {user.role}
                  </p>
                </div>
              </div>
            ) : null}
            {user?.lastLoginAt ? (
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                Last signed in {formatDateTime(user.lastLoginAt)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------ appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-muted-foreground" aria-hidden="true" />
              Appearance
            </CardTitle>
            <CardDescription>
              Currently showing the {resolvedTheme} theme. Your choice is remembered on this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset>
              <legend className="sr-only">Theme</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {THEME_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors',
                      'focus-within:ring-2 focus-within:ring-ring',
                      theme === option.value
                        ? 'border-primary bg-primary/[0.06]'
                        : 'border-border hover:border-primary/40 hover:bg-muted',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="theme"
                        value={option.value}
                        checked={theme === option.value}
                        onChange={() => setTheme(option.value)}
                        className="sr-only"
                      />
                      <option.icon
                        className={cn('size-4', theme === option.value ? 'text-primary' : 'text-muted-foreground')}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-foreground">{option.label}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </CardContent>
        </Card>

        {/* -------------------------------------------------------------- AI */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
              AI assistant
            </CardTitle>
            <CardDescription>Configured on the server; no API key is ever sent to the browser.</CardDescription>
          </CardHeader>
          <CardContent>
            {aiStatus ? (
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="font-medium text-foreground">{aiStatus.provider}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="truncate font-mono text-xs text-foreground">{aiStatus.model}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">API key required</dt>
                  <dd className="font-medium text-foreground">{aiStatus.requiresApiKey ? 'Yes' : 'No'}</dd>
                </div>
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">{aiStatus.description}</p>
              </dl>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------- workspace */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
              Workspace
            </CardTitle>
            <CardDescription>Buildings and floors currently configured.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {buildingsLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              buildings?.map((building) => (
                <div key={building.id}>
                  <p className="text-sm font-medium text-foreground">
                    {building.name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">({building.code})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{building.address}</p>
                  <ul className="mt-2 space-y-1">
                    {building.floors.map((floor) => (
                      <li key={floor.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">{floor.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {floor.occupiedCount}/{floor.seatCount} desks occupied
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
