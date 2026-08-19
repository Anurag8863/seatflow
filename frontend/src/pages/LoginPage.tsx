import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Building2, Eye, EyeOff, ShieldCheck, Sparkles, Map } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

const HIGHLIGHTS = [
  { icon: Map, title: 'Live floor plans', body: 'See every desk, who sits where, and what is free.' },
  { icon: Sparkles, title: 'AI seating commands', body: 'Describe a change; review it before anything is applied.' },
  { icon: ShieldCheck, title: 'Full audit trail', body: 'Every assignment, move and release is recorded.' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (submitError) {
      setError(errorMessage(submitError, 'We could not sign you in. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Marketing panel — hidden on small screens so the form stays front and centre. */}
      <aside className="relative hidden flex-col justify-between bg-slate-950 p-10 text-slate-100 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="size-4" aria-hidden="true" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">SeatFlow</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">
            Office seating that stays in sync with the people in it.
          </h2>
          <ul className="mt-8 space-y-5">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <item.icon className="size-4 text-sky-300" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-400">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-500">Workplace operations · Internal tool</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">SeatFlow</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use your workplace administrator account to manage seating.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}

            <Field id="email" label="Email address" required>
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="admin@seatflow.io"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              )}
            </Field>

            <Field id="password" label="Password" required>
              {(fieldProps) => (
                <div className="relative">
                  <Input
                    {...fieldProps}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
              )}
            </Field>

            <Button type="submit" className="w-full" loading={submitting}>
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Seeded demo account:{' '}
            <span className="font-mono text-foreground">admin@seatflow.io</span> /{' '}
            <span className="font-mono text-foreground">SeatFlow!2024</span>
          </p>
        </div>
      </main>
    </div>
  );
}
