export const MAX_BATCH_SIZE = 500;

export interface BatchVerifyResult {
  id: string;
  status: 'valid' | 'invalid' | 'error';
  chainOfCustody: string;
  error?: string;
}

export interface ParsedCsvResult {
  ids: string[];
  errors: string[];
}

/**
 * Parse a CSV file's text content into a list of certificate IDs.
 * Accepts either a single-column list or a CSV with a header row
 * (e.g. "certificate_id"). Enforces the MAX_BATCH_SIZE cap.
 */
export function parseCertificateCsv(text: string): ParsedCsvResult {
  const errors: string[] = [];
  const ids: string[] = [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { ids, errors: ['CSV file is empty.'] };
  }

  // Detect and skip a header row.
  const firstCell = lines[0].split(',')[0].trim().toLowerCase();
  const hasHeader = firstCell === 'id' || firstCell === 'certificate_id' || firstCell === 'cert_id';
  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    const id = line.split(',')[0].trim();
    if (id.length > 0) {
      ids.push(id);
    }
  }

  if (ids.length === 0) {
    errors.push('No certificate IDs found in CSV.');
  }

  if (ids.length > MAX_BATCH_SIZE) {
    errors.push(
      `Too many certificate IDs (${ids.length}). Maximum allowed is ${MAX_BATCH_SIZE}.`,
    );
  }

  return { ids, errors };
}

/**
 * Verify a single certificate ID against the public verify endpoint.
 */
async function verifyOne(id: string): Promise<BatchVerifyResult> {
  try {
    const res = await fetch(`/api/v1/verify/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        id,
        status: 'error',
        chainOfCustody: '',
        error: `Request failed with status ${res.status}`,
      };
    }

    const data = await res.json();
    const valid = Boolean(data?.valid ?? data?.verified ?? data?.status === 'valid');
    const chainOfCustody =
      typeof data?.chainOfCustody === 'string'
        ? data.chainOfCustody
        : Array.isArray(data?.chainOfCustody)
          ? data.chainOfCustody.join(' > ')
          : '';

    return {
      id,
      status: valid ? 'valid' : 'invalid',
      chainOfCustody,
    };
  } catch (err) {
    return {
      id,
      status: 'error',
      chainOfCustody: '',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Verify a batch of certificate IDs in parallel, reporting progress as each
 * request settles. Enforces the MAX_BATCH_SIZE cap.
 */
export async function verifyBatch(
  ids: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<BatchVerifyResult[]> {
  const capped = ids.slice(0, MAX_BATCH_SIZE);
  const total = capped.length;
  let completed = 0;

  const results = await Promise.all(
    capped.map(async (id) => {
      const result = await verifyOne(id);
      completed += 1;
      onProgress?.(completed, total);
      return result;
    }),
  );

  return results;
}

/**
 * Serialize batch results to CSV with columns: cert ID, status, chain-of-custody.
 */
export function resultsToCsv(results: BatchVerifyResult[]): string {
  const escape = (value: string) => {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const header = ['cert_id', 'status', 'chain_of_custody'];
  const rows = results.map((r) => [r.id, r.status, r.chainOfCustody].map(escape).join(','));

  return [header.join(','), ...rows].join('\n');
}
