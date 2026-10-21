'use client';

import { useCallback, useRef, useState } from 'react';

const MAX_IDS = 500;
const VERIFY_ENDPOINT = '/api/v1/verify';

type BatchStatus = 'pending' | 'verifying' | 'verified' | 'failed';

interface BatchResult {
  id: string;
  status: BatchStatus;
  chainOfCustody: string;
  error?: string;
}

function parseCsv(text: string): string[] {
  const ids: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const cells = line.split(',');
    for (const cell of cells) {
      const value = cell.trim().replace(/^"|"$/g, '');
      if (!value) continue;
      if (value.toLowerCase() === 'certificate id' || value.toLowerCase() === 'id') continue;
      ids.push(value);
    }
  }
  return ids;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default function BatchVerifyUpload() {
  const [results, setResults] = useState<BatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runBatch = useCallback(async (ids: string[]) => {
    setIsVerifying(true);
    setProgress(0);
    setError(null);
    setResults(ids.map((id) => ({ id, status: 'pending', chainOfCustody: '' })));

    let completed = 0;
    await Promise.all(
      ids.map(async (id) => {
        let update: BatchResult;
        try {
          const res = await fetch(`${VERIFY_ENDPOINT}/${encodeURIComponent(id)}`);
          if (!res.ok) {
            update = {
              id,
              status: 'failed',
              chainOfCustody: '',
              error: `Verification failed (HTTP ${res.status})`,
            };
          } else {
            const data = await res.json();
            const verified = data?.verified ?? data?.valid ?? false;
            update = {
              id,
              status: verified ? 'verified' : 'failed',
              chainOfCustody: String(data?.chainOfCustody ?? data?.chain_of_custody ?? ''),
              error: verified ? undefined : data?.error ?? 'Certificate could not be verified',
            };
          }
        } catch (err) {
          update = {
            id,
            status: 'failed',
            chainOfCustody: '',
            error: err instanceof Error ? err.message : 'Network error',
          };
        }
        completed += 1;
        setProgress(Math.round((completed / ids.length) * 100));
        setResults((prev) => prev.map((r) => (r.id === id ? update : r)));
      }),
    );

    setIsVerifying(false);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const text = await file.text();
      const ids = parseCsv(text);
      if (ids.length === 0) {
        setError('No certificate IDs found in the uploaded CSV.');
        return;
      }
      if (ids.length > MAX_IDS) {
        setError(`Too many certificate IDs (${ids.length}). Maximum is ${MAX_IDS}.`);
        return;
      }
      await runBatch(ids);
    },
    [runBatch],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const handleDownload = useCallback(() => {
    const header = 'certificate_id,status,chain_of_custody\n';
    const rows = results
      .map((r) =>
        [escapeCsv(r.id), escapeCsv(r.status), escapeCsv(r.chainOfCustody)].join(','),
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'batch-verification-results.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [results]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="batch-csv">
          Upload CSV of certificate IDs (max {MAX_IDS})
        </label>
        <input
          id="batch-csv"
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleChange}
          disabled={isVerifying}
          className="mt-1 block w-full text-sm text-gray-700"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {isVerifying && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
            <div
              className="h-full bg-green-600 transition-all"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="mt-1 text-xs text-gray-600">{progress}% complete</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Results</h3>
            <button
              type="button"
              onClick={handleDownload}
              disabled={isVerifying}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Download CSV
            </button>
          </div>
          <ul className="divide-y divide-gray-200 rounded border border-gray-200">
            {results.map((r) => (
              <li key={r.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-gray-800">{r.id}</span>
                  <span
                    className={
                      r.status === 'verified'
                        ? 'text-green-600'
                        : r.status === 'failed'
                          ? 'text-red-600'
                          : 'text-gray-500'
                    }
                  >
                    {r.status}
                  </span>
                </div>
                {r.chainOfCustody && (
                  <p className="text-xs text-gray-500">Chain of custody: {r.chainOfCustody}</p>
                )}
                {r.error && <p className="text-xs text-red-600">{r.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
