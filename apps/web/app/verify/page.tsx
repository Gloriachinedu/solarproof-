'use client';

import { useCallback, useRef, useState } from 'react';

const MAX_IDS = 500;

interface BatchResult {
  id: string;
  status: string;
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
      if (value.toLowerCase() === 'id' || value.toLowerCase() === 'certificate id') continue;
      ids.push(value);
    }
  }
  return ids;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export default function VerifyPage() {
  const [singleId, setSingleId] = useState('');
  const [singleResult, setSingleResult] = useState<BatchResult | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);

  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const verifyOne = useCallback(async (id: string): Promise<BatchResult> => {
    try {
      const res = await fetch(`/api/v1/verify/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          id,
          status: 'error',
          chainOfCustody: '',
          error: data?.error || data?.message || `Request failed (${res.status})`,
        };
      }
      return {
        id,
        status: data?.status ?? (data?.valid ? 'valid' : 'invalid'),
        chainOfCustody: data?.chainOfCustody ?? data?.chain_of_custody ?? '',
      };
    } catch (err) {
      return {
        id,
        status: 'error',
        chainOfCustody: '',
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }, []);

  const handleSingleVerify = useCallback(async () => {
    const id = singleId.trim();
    if (!id) return;
    setSingleLoading(true);
    setSingleResult(null);
    const result = await verifyOne(id);
    setSingleResult(result);
    setSingleLoading(false);
  }, [singleId, verifyOne]);

  const handleFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadError(null);
      setBatchResults([]);
      setProgress({ done: 0, total: 0 });

      const text = await file.text();
      const ids = parseCsv(text);

      if (ids.length === 0) {
        setUploadError('No certificate IDs found in the uploaded CSV.');
        return;
      }
      if (ids.length > MAX_IDS) {
        setUploadError(
          `Too many certificate IDs (${ids.length}). Maximum is ${MAX_IDS} per batch.`,
        );
        return;
      }

      setBatchRunning(true);
      setProgress({ done: 0, total: ids.length });

      let done = 0;
      const results = await Promise.all(
        ids.map(async (id) => {
          const result = await verifyOne(id);
          done += 1;
          setProgress({ done, total: ids.length });
          return result;
        }),
      );

      setBatchResults(results);
      setBatchRunning(false);
    },
    [verifyOne],
  );

  const handleDownload = useCallback(() => {
    const header = 'certificate_id,status,chain_of_custody\n';
    const rows = batchResults
      .map((r) =>
        [escapeCsv(r.id), escapeCsv(r.status), escapeCsv(r.chainOfCustody)].join(','),
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'batch-verification-results.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [batchResults]);

  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Verify a certificate</h1>
      <p className="mt-2 text-sm text-gray-600">
        Verify a single certificate ID or upload a CSV to verify up to {MAX_IDS} IDs at once.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Single verification</h2>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={singleId}
            onChange={(e) => setSingleId(e.target.value)}
            placeholder="Certificate ID"
            className="flex-1 rounded border border-gray-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={handleSingleVerify}
            disabled={singleLoading || !singleId.trim()}
            className="rounded bg-green-700 px-4 py-2 text-white disabled:opacity-50"
          >
            {singleLoading ? 'Verifying…' : 'Verify'}
          </button>
        </div>
        {singleResult && (
          <div className="mt-3 rounded border border-gray-200 p-3 text-sm">
            <div>
              <span className="font-medium">Status:</span> {singleResult.status}
            </div>
            {singleResult.chainOfCustody && (
              <div>
                <span className="font-medium">Chain of custody:</span>{' '}
                {singleResult.chainOfCustody}
              </div>
            )}
            {singleResult.error && (
              <div className="text-red-600">{singleResult.error}</div>
            )}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Batch verification (CSV)</h2>
        <p className="mt-1 text-sm text-gray-600">
          Upload a CSV containing certificate IDs (one per row or comma-separated). Maximum{' '}
          {MAX_IDS} IDs.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          disabled={batchRunning}
          className="mt-3 block text-sm"
        />

        {uploadError && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {uploadError}
          </p>
        )}

        {progress.total > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-600">
              <span>
                {progress.done} / {progress.total} verified
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded bg-gray-200">
              <div
                className="h-full bg-green-700 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {batchResults.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Results</h3>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded border border-green-700 px-3 py-1 text-sm text-green-700"
              >
                Download CSV
              </button>
            </div>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2">Certificate ID</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Chain of custody</th>
                </tr>
              </thead>
              <tbody>
                {batchResults.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 font-mono">{r.id}</td>
                    <td className="py-2">
                      {r.error ? (
                        <span className="text-red-600">{r.error}</span>
                      ) : (
                        r.status
                      )}
                    </td>
                    <td className="py-2">{r.chainOfCustody || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
