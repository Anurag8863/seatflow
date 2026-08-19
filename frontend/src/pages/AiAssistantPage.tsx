import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CornerDownLeft, Cpu, Info, Sparkles, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { AiExecutionResult, AiPlan, AiStatus } from '@/lib/types';
import { formatTime } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/providers/WorkspaceProvider';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import {
  AiAnswerCard,
  AiClarificationCard,
  AiConfirmationCard,
  AiErrorCard,
  AiRejectionCard,
  AiSuccessCard,
} from '@/components/ai/AiResultCards';
import { AiHistoryPanel } from '@/components/ai/AiHistoryPanel';

const EXAMPLE_PROMPTS = [
  'Move Rahul Sharma to seat B-07',
  'Move Priya from A-12 to B-04',
  'Assign Tomas Novak to the next available seat on Floor 2',
  'Which seats are available on Floor 2?',
  'How many seats are occupied on Floor 1?',
  'Find an available seat near the Engineering team',
  'Move all available Marketing employees to Floor 3',
  'Release seat A-05',
];

interface Entry {
  id: string;
  prompt: string;
  at: string;
  plan?: AiPlan;
  execution?: AiExecutionResult;
  cancelled?: boolean;
  error?: string;
}

const AFFECTED_QUERIES = ['dashboard', 'seats', 'employees', 'floor-plan', 'audit-logs', 'buildings'];

export function AiAssistantPage() {
  const { canWrite } = useAuth();
  const { buildingId } = useWorkspace();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = React.useState('');
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const transcriptEndRef = React.useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ['ai-status'],
    queryFn: async () => (await api.get<AiStatus>('/ai/status')).data,
    staleTime: 10 * 60 * 1000,
  });

  React.useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries]);

  function refreshSeatingData() {
    for (const key of AFFECTED_QUERIES) void queryClient.invalidateQueries({ queryKey: [key] });
    void queryClient.invalidateQueries({ queryKey: ['ai-actions'] });
  }

  const interpret = useMutation({
    mutationFn: async (input: {
      prompt: string;
      selectedEmployeeId?: string;
      selectedFloorId?: string;
      scopeBuildingId?: string | null;
    }) => (await api.post<AiPlan>('/ai/interpret', input)).data,
  });

  const execute = useMutation({
    mutationFn: async (aiActionId: string) =>
      (await api.post<AiExecutionResult>('/ai/execute', { aiActionId })).data,
  });

  const cancel = useMutation({
    mutationFn: async (aiActionId: string) => (await api.post('/ai/cancel', { aiActionId })).data,
  });

  const [pendingEntryId, setPendingEntryId] = React.useState<string | null>(null);

  async function submitPrompt(text: string, options: { selectedEmployeeId?: string; selectedFloorId?: string } = {}) {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;

    const entryId = 'entry-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    setEntries((current) => [...current, { id: entryId, prompt: trimmed, at: new Date().toISOString() }]);
    setPrompt('');
    setPendingEntryId(entryId);

    try {
      // The building currently open in the UI scopes a bare "Floor 2".
      const plan = await interpret.mutateAsync({ prompt: trimmed, scopeBuildingId: buildingId, ...options });
      setEntries((current) => current.map((entry) => (entry.id === entryId ? { ...entry, plan } : entry)));

      if (plan.kind === 'mutation') {
        toast.info('AI action requires confirmation', { description: plan.preview?.description });
      }
      // Queries are read-only, but the history panel should still refresh.
      void queryClient.invalidateQueries({ queryKey: ['ai-actions'] });
    } catch (error) {
      const message = errorMessage(error, 'The assistant could not process that request.');
      setEntries((current) => current.map((entry) => (entry.id === entryId ? { ...entry, error: message } : entry)));
      toast.error(message);
    } finally {
      setPendingEntryId(null);
    }
  }

  async function confirmEntry(entry: Entry) {
    if (!entry.plan) return;
    try {
      const result = await execute.mutateAsync(entry.plan.aiActionId);
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? { ...item, execution: result } : item)),
      );
      refreshSeatingData();
      toast.success(result.summary);
    } catch (error) {
      const message = errorMessage(error, 'The change could not be applied.');
      setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, error: message } : item)));
      refreshSeatingData();
      toast.error(message);
    }
  }

  async function cancelEntry(entry: Entry) {
    if (!entry.plan) return;
    try {
      await cancel.mutateAsync(entry.plan.aiActionId);
      setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, cancelled: true } : item)));
      void queryClient.invalidateQueries({ queryKey: ['ai-actions'] });
      toast.message('AI action cancelled', { description: 'Nothing was changed.' });
    } catch (error) {
      toast.error(errorMessage(error, 'The action could not be cancelled.'));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt(prompt);
    }
  }

  const busy = interpret.isPending || pendingEntryId !== null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Assistant"
        description="Describe a seating change in plain English. Every change is previewed and confirmed before it is applied."
        actions={
          entries.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setEntries([])}>
              <Trash2 aria-hidden="true" />
              Clear session
            </Button>
          ) : undefined
        }
      />

      {status ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
          <Cpu className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="font-medium text-foreground">
            {status.provider === 'local' ? 'Built-in interpreter' : status.provider + ' · ' + status.model}
          </span>
          <span className="hidden sm:inline">·</span>
          <span>{status.description}</span>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ------------------------------------------------------- transcript */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex min-h-[22rem] flex-col">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                Seating command centre
              </CardTitle>
              <CardDescription>Tell me what you want to change.</CardDescription>
            </CardHeader>

            <CardContent className="flex-1 space-y-5 overflow-y-auto scrollbar-thin p-5">
              {entries.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                  <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="size-5 text-primary" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-foreground">Nothing asked yet</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Try one of the example prompts below, or describe the change in your own words.
                  </p>
                </div>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} className="space-y-3">
                    {/* the administrator's prompt */}
                    <div className="flex items-start justify-end gap-2.5">
                      <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                        {entry.prompt}
                        <span className="mt-1 block text-[11px] opacity-70">{formatTime(entry.at)}</span>
                      </div>
                      <Avatar name="You" className="mt-0.5 size-7 bg-primary/15 text-[10px]" />
                    </div>

                    {/* the assistant's response */}
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        {entry.error ? (
                          <AiErrorCard message={entry.error} />
                        ) : !entry.plan ? (
                          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                            <span className="flex gap-1" aria-hidden="true">
                              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                            </span>
                            Interpreting your request…
                          </div>
                        ) : entry.execution ? (
                          <AiSuccessCard result={entry.execution} />
                        ) : entry.cancelled ? (
                          <AiErrorCard message="Cancelled — nothing was changed." />
                        ) : entry.plan.kind === 'mutation' ? (
                          <AiConfirmationCard
                            plan={entry.plan}
                            confirming={execute.isPending}
                            cancelling={cancel.isPending}
                            onConfirm={() => void confirmEntry(entry)}
                            onCancel={() => void cancelEntry(entry)}
                          />
                        ) : entry.plan.kind === 'answer' && entry.plan.answer ? (
                          <AiAnswerCard answer={entry.plan.answer} />
                        ) : entry.plan.kind === 'clarification' ? (
                          <AiClarificationCard
                            plan={entry.plan}
                            disabled={busy}
                            onChoose={(optionId) => {
                              // The plan says whether the options are people or floors.
                              void submitPrompt(
                                entry.prompt,
                                entry.plan?.optionKind === 'floor'
                                  ? { selectedFloorId: optionId }
                                  : { selectedEmployeeId: optionId },
                              );
                            }}
                          />
                        ) : (
                          <AiRejectionCard message={entry.plan.message ?? 'That request is not supported.'} />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </CardContent>

            {/* --------------------------------------------------- composer */}
            <div className="border-t border-border p-4">
              {canWrite ? (
                <>
                  <div className="relative">
                    <label htmlFor="ai-prompt" className="sr-only">
                      Describe the seating change you want
                    </label>
                    <Textarea
                      id="ai-prompt"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onKeyDown={onKeyDown}
                      placeholder="e.g. Move Rahul Sharma to seat B-07"
                      rows={2}
                      maxLength={500}
                      disabled={busy}
                      className="min-h-[3.25rem] resize-none pr-28"
                    />
                    <Button
                      onClick={() => void submitPrompt(prompt)}
                      disabled={prompt.trim().length < 3}
                      loading={busy}
                      size="sm"
                      className="absolute bottom-2 right-2"
                    >
                      Send
                      <CornerDownLeft aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Enter to send · Shift + Enter for a new line · nothing is applied without your confirmation
                  </p>
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="size-4" aria-hidden="true" />
                  Your role has read-only access, so the assistant cannot make changes.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Example prompts</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      disabled={busy || !canWrite}
                      onClick={() => void submitPrompt(example)}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* ---------------------------------------------------------- history */}
        <div className="min-w-0">
          <AiHistoryPanel />
        </div>
      </div>
    </div>
  );
}
