'use client';

import { useEffect, useState } from 'react';

interface ProviderModel {
  id: string;
  name: string;
}

interface ProviderModelFieldProps {
  keyId: string;
  name: string;
  disabled?: boolean;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
}

export function ProviderModelField({
  keyId,
  name,
  disabled = false,
  required = false,
  value,
  onChange,
}: ProviderModelFieldProps) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (keyId.length === 0) {
      setModels([]);
      setStatus('idle');
      return;
    }

    let isCurrent = true;
    setStatus('loading');

    fetch(`/api/models?keyId=${encodeURIComponent(keyId)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Provider models request failed');
        }

        return (await response.json()) as { models?: ProviderModel[] };
      })
      .then((payload) => {
        if (!isCurrent) {
          return;
        }

        const nextModels = payload.models ?? [];
        setModels(nextModels);
        setStatus('idle');

        if (nextModels.length > 0 && (!value || !nextModels.some((model) => model.id === value))) {
          onChange?.(nextModels[0].id);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setStatus('error');
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [keyId, onChange, value]);

  return (
    <label>
      <span>Model</span>
      <select
        name={name}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
        required={required}
        disabled={disabled || keyId.length === 0 || status === 'loading' || models.length === 0}
      >
        {keyId.length === 0 ? <option value="">Choose a saved key first</option> : null}
        {status === 'loading' ? <option value="">Loading models</option> : null}
        {status === 'error' ? <option value="">Models unavailable</option> : null}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
    </label>
  );
}