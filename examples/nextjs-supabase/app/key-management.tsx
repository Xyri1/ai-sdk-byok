'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KeyMetadata } from 'ai-sdk-byok';
import { deleteKeyAction, saveKeyAction, type KeyActionState } from './actions';
import { supportedProviders, type SupportedProvider } from '@/lib/providers';

const initialState: KeyActionState = { status: 'idle', message: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? 'Saving' : 'Save key'}</button>;
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button className="icon-button" title="Delete key" aria-label="Delete key" disabled={pending}>
      x
    </button>
  );
}

function formatTimestamp(value: string): string {
  return value.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function KeyManagement({ keys }: { keys: KeyMetadata[] }) {
  const [state, formAction] = useActionState(saveKeyAction, initialState);
  const [provider, setProvider] = useState<SupportedProvider>('openai');

  return (
    <section className="workspace" aria-label="Key management">
      <form className="panel key-form" action={formAction}>
        <div className="section-heading">
          <h2>Save or rotate a key</h2>
          <p>Credentials stay server-side; this screen only renders metadata after save.</p>
        </div>
        <label>
          <span>Provider</span>
          <select
            name="provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as SupportedProvider)}
            required
          >
            {supportedProviders.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Label</span>
          <input name="label" defaultValue="default" autoComplete="off" />
        </label>
        <label className="wide-field">
          <span>API key</span>
          <input name="apiKey" type="password" autoComplete="off" required />
        </label>
        <div className="form-footer">
          <SubmitButton />
          {state.message ? <p className={`status ${state.status}`}>{state.message}</p> : null}
        </div>
      </form>

      <section className="panel key-list" aria-label="Stored keys">
        <div className="section-heading">
          <h2>Stored metadata</h2>
          <p>Key hints show only the final characters of each API key.</p>
        </div>
        <div className="table">
          <div className="row header">
            <span>Provider</span>
            <span>Label</span>
            <span>Hint</span>
            <span>Updated</span>
            <span aria-hidden="true" />
          </div>
          {keys.length === 0 ? (
            <div className="empty">No keys saved for this demo user.</div>
          ) : (
            keys.map((key) => (
              <div className="row" key={key.id}>
                <span>{key.provider}</span>
                <span>{key.label}</span>
                <span className="hint">...{key.keyHint}</span>
                <span>{formatTimestamp(key.updatedAt)}</span>
                <form action={deleteKeyAction}>
                  <input type="hidden" name="keyId" value={key.id} />
                  <DeleteButton />
                </form>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}