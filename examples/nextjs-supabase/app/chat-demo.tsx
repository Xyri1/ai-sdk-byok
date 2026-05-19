'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { KeyMetadata } from 'ai-sdk-byok';
import { ProviderModelField } from './provider-model-field';
import { getProviderLabel } from '@/lib/providers';

export function ChatDemo({ keys }: { keys: KeyMetadata[] }) {
  const [selectedKeyId, setSelectedKeyId] = useState(keys[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Write a one-sentence haiku about encrypted key storage.');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const selectedKey = useMemo(
    () => keys.find((key) => key.id === selectedKeyId) ?? null,
    [keys, selectedKeyId],
  );

  useEffect(() => {
    if (selectedKeyId.length === 0 || keys.some((key) => key.id === selectedKeyId)) {
      return;
    }

    setSelectedKeyId(keys[0]?.id ?? '');
    setModel('');
  }, [keys, selectedKeyId]);

  async function runChat() {
    setError('');
    setResponse('');

    if (selectedKey === null) {
      setError('Save a key before running chat.');
      return;
    }

    setIsRunning(true);

    try {
      const result = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId: selectedKey.id, model, prompt }),
      });

      if (!result.ok || !result.body) {
        const payload = (await result.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? 'The chat request failed.');
        return;
      }

      const reader = result.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        setResponse((current) => current + decoder.decode(value, { stream: true }));
      }
    } catch {
      setError('The chat request failed.');
    } finally {
      setIsRunning(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runChat();
  }

  return (
    <section className="panel chat-panel" aria-label="AI SDK route example">
      <div className="section-heading">
        <h2>AI SDK route</h2>
        <p>Runs a server route using one of the saved keys above.</p>
      </div>
      <form onSubmit={onSubmit}>
        <label>
          <span>Saved key</span>
          <select
            value={selectedKeyId}
            onChange={(event) => {
              setSelectedKeyId(event.target.value);
              setModel('');
            }}
            required
            disabled={isRunning || keys.length === 0}
          >
            {keys.length === 0 ? <option value="">No saved keys</option> : null}
            {keys.map((key) => (
              <option key={key.id} value={key.id}>
                {getProviderLabel(key.provider)} / {key.label} / ...{key.keyHint}
              </option>
            ))}
          </select>
        </label>
        {selectedKey ? (
          <ProviderModelField
            keyId={selectedKey.id}
            name="model"
            disabled={isRunning}
            required
            value={model}
            onChange={setModel}
          />
        ) : null}
        <label className="wide-field">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            required
            disabled={isRunning}
          />
        </label>
        <button className="run-button" disabled={isRunning || selectedKey === null}>
          {isRunning ? <span className="spinner" aria-hidden="true" /> : null}
          {isRunning ? 'Running chat' : 'Run chat'}
        </button>
      </form>
      {isRunning ? <p className="status running" role="status">Request running. Streaming response as tokens arrive.</p> : null}
      {error ? <p className="status error">{error}</p> : null}
      <pre className={`response${isRunning ? ' active' : ''}`} aria-live="polite">
        {response || (isRunning ? 'Waiting for the first token...' : 'No response yet.')}
      </pre>
    </section>
  );
}