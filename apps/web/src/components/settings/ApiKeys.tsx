import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { BalanceMeter } from '@/components/community/BalanceMeter';
import { Button, buttonStyles, Dialog, Input } from '@/components/ui';
import { ApiError, call, client, type Schemas } from '@/lib/api';
import { PROVIDERS, quotaText, useQuota, type Provider } from '@/lib/community';
import { formatDate } from '@/lib/format';

type KeyInfo = Schemas['ApiKeyInfo'];
const ORDER: Provider[] = ['openrouter', 'openai', 'gemini'];
const keysQuery = { queryKey: ['keys'], queryFn: () => call(client.GET('/api/keys')), staleTime: 60_000 };

/** The words for what went wrong saving a key (docs/community.md, Client UX 9). */
function saveError(e: unknown, provider: Provider) {
  const name = PROVIDERS[provider].name;
  if (e instanceof ApiError) {
    if (e.code === 'invalid_key') return `${name} didn't accept that key. Check that you copied all of it.`;
    if (e.code === 'key_check_failed') return `Couldn't reach ${name} to check the key. Try again.`;
    if (e.code === 'keys_unavailable') return "Saving keys isn't available right now. Try again later.";
    if (e.status === 429) return 'Too many tries. Wait a minute, then try again.';
  }
  return e instanceof Error && e.message ? e.message : 'Could not save the key. Try again.';
}

const REMOVE_NOTE: Record<Provider, string> = {
  openrouter: 'Your tests go back to the community balance, with 1 test a day for speaking and for writing.',
  openai: 'GPT-Live stops working until you add an OpenAI key again.',
  gemini: 'Gemini Live stops working until you add a Gemini key again.',
};

/** One provider: what it unlocks and where to get a key, then either a masked saved key (Replace, Remove) or the field to add one. */
function KeyRow({ provider, info }: { provider: Provider; info?: KeyInfo }) {
  const qc = useQueryClient();
  const p = PROVIDERS[provider];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['keys'] }), qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['quota'] })]);

  const save = useMutation({
    mutationFn: () => call(client.PUT('/api/keys/{provider}', { params: { path: { provider } }, body: { key: value.trim() } })),
    onSuccess: async () => {
      setValue('');
      setEditing(false);
      await done();
    },
  });
  const remove = useMutation({
    mutationFn: () => call(client.DELETE('/api/keys/{provider}', { params: { path: { provider } } })),
    onSuccess: async () => {
      setConfirm(false);
      await done();
    },
  });

  const stopped = info && !info.valid;
  const showField = !info || stopped || editing;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim().length >= 8) save.mutate();
  };

  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">
          {p.name} <span className="font-normal text-muted">· {p.unlocks}</span>
        </h3>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: 'link', className: 'type-caption hit' })}>
          Get a key <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">(opens {p.name} in a new tab)</span>
        </a>
      </div>
      <p className="type-caption mt-0.5 max-w-[60ch]">{p.help}</p>

      {info && !showField && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="type-num text-sm">
            <span aria-label={`Saved key ending in ${info.last4}`}>•••• {info.last4}</span>
            <span className="text-muted">, added {formatDate(info.addedAt)}</span>
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button ref={removeButton} variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              Remove
            </Button>
          </div>
        </div>
      )}

      {showField && (
        <form onSubmit={submit} className="mt-3" noValidate>
          {stopped && (
            <p role="alert" className="mb-2 text-sm font-medium text-warn-text">
              This key stopped working. Enter a new one.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <Input
                label={`${p.name} API key`}
                hideLabel
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={p.placeholder}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (save.error) save.reset();
                }}
                error={save.error && saveError(save.error, provider)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={save.isPending} disabled={value.trim().length < 8}>
                Save
              </Button>
              {editing && !save.isPending && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setValue('');
                    save.reset();
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <p className="type-caption mt-2 empty:hidden" role="status">
            {save.isPending ? 'Checking your key...' : ''}
          </p>
        </form>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        returnFocusRef={removeButton}
        title={`Remove your ${p.name} key?`}
        description={REMOVE_NOTE[provider]}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep key
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove key
            </Button>
          </>
        }
      >
        {remove.error && <p className="text-sm text-bad-text">{remove.error.message}</p>}
      </Dialog>
    </div>
  );
}

/** Where you stand now: which tier, how many tests, what pays for them. The first thing under "Your API keys". */
function Standing() {
  const { data } = useQuota();
  if (!data) return null;
  const own = data.tier === 'own-key';
  const guestLine = (skill: 'speaking' | 'writing') => quotaText(data[skill], data.tier).text;
  return (
    <div className="space-y-3 pb-5">
      <p className="text-sm">
        {own ? 'Your tests are paid from your own OpenRouter key, so there is no daily limit.' : 'Your tests are paid from the community balance: 1 speaking and 1 writing test a day. Add an OpenRouter key for unlimited tests.'}
      </p>
      {!own && (
        <p className="type-caption type-num">
          Speaking: {guestLine('speaking')}. Writing: {guestLine('writing')}.
        </p>
      )}
      {!own && <BalanceMeter className="max-w-xs" />}
    </div>
  );
}

/** Settings → Your API keys. Keys are stored encrypted on the server and never sent back; only the last four characters are shown. */
export function ApiKeys() {
  const { data, isPending, isError, refetch } = useQuery(keysQuery);
  const by = new Map((data?.keys ?? []).map((k) => [k.provider, k]));
  return (
    <>
      <Standing />
      {isPending ? (
        <p className="type-caption py-4" aria-busy>
          Loading your keys...
        </p>
      ) : isError ? (
        <p className="py-4 text-sm">
          Couldn't load your keys.{' '}
          <button type="button" onClick={() => void refetch()} className={buttonStyles({ variant: 'link' })}>
            Try again
          </button>
        </p>
      ) : (
        <div className="divide-y divide-line py-5">
          {ORDER.map((provider) => (
            <KeyRow key={provider} provider={provider} info={by.get(provider)} />
          ))}
        </div>
      )}
      <p className="type-caption pt-5">Your key is stored encrypted on our server and only used for your tests. Remove it any time.</p>
    </>
  );
}
