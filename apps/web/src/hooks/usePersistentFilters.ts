import { useCallback, useEffect, useRef, useState } from 'react';

export interface DashboardFilters {
  dateRange: {
    from: string | null;
    to: string | null;
  };
  meterIds: string[];
  certificateStatus: string | null;
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  dateRange: {
    from: null,
    to: null,
  },
  meterIds: [],
  certificateStatus: null,
};

const STORAGE_KEY_PREFIX = 'solaproof:filters:';
const DEBOUNCE_MS = 300;

function getStorageKey(userId: string | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}${userId ?? 'anonymous'}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isValidFilters(value: unknown): value is DashboardFilters {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const dateRange = candidate.dateRange;
  if (typeof dateRange !== 'object' || dateRange === null) {
    return false;
  }
  const range = dateRange as Record<string, unknown>;
  const fromOk = range.from === null || typeof range.from === 'string';
  const toOk = range.to === null || typeof range.to === 'string';
  const meterIdsOk =
    Array.isArray(candidate.meterIds) &&
    candidate.meterIds.every((id) => typeof id === 'string');
  const statusOk =
    candidate.certificateStatus === null || typeof candidate.certificateStatus === 'string';
  return fromOk && toOk && meterIdsOk && statusOk;
}

function readStoredFilters(userId: string | null | undefined): DashboardFilters {
  if (!isBrowser()) {
    return DEFAULT_DASHBOARD_FILTERS;
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) {
      return DEFAULT_DASHBOARD_FILTERS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidFilters(parsed)) {
      return DEFAULT_DASHBOARD_FILTERS;
    }
    return {
      dateRange: {
        from: parsed.dateRange.from,
        to: parsed.dateRange.to,
      },
      meterIds: [...parsed.meterIds],
      certificateStatus: parsed.certificateStatus,
    };
  } catch {
    return DEFAULT_DASHBOARD_FILTERS;
  }
}

function writeStoredFilters(userId: string | null | undefined, filters: DashboardFilters): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(filters));
  } catch {
    // Ignore storage errors (quota exceeded, privacy mode, etc.)
  }
}

function clearStoredFilters(userId: string | null | undefined): void {
  if (!isBrowser()) {
    return;
  }
  try {
    window.localStorage.removeItem(getStorageKey(userId));
  } catch {
    // Ignore storage errors
  }
}

export interface UsePersistentFiltersResult {
  filters: DashboardFilters;
  setFilters: (next: DashboardFilters | ((prev: DashboardFilters) => DashboardFilters)) => void;
  updateFilters: (patch: Partial<DashboardFilters>) => void;
  resetFilters: () => void;
  isHydrated: boolean;
}

export function usePersistentFilters(
  userId: string | null | undefined,
): UsePersistentFiltersResult {
  const [filters, setFiltersState] = useState<DashboardFilters>(DEFAULT_DASHBOARD_FILTERS);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef<string | null | undefined>(userId);

  // Restore persisted state on mount (and when the user changes).
  useEffect(() => {
    userIdRef.current = userId;
    const restored = readStoredFilters(userId);
    setFiltersState(restored);
    setIsHydrated(true);
  }, [userId]);

  // Persist state on change with debouncing.
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      writeStoredFilters(userIdRef.current, filters);
      debounceRef.current = null;
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [filters, isHydrated]);

  const setFilters = useCallback(
    (next: DashboardFilters | ((prev: DashboardFilters) => DashboardFilters)) => {
      setFiltersState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        return {
          dateRange: {
            from: resolved.dateRange.from,
            to: resolved.dateRange.to,
          },
          meterIds: [...resolved.meterIds],
          certificateStatus: resolved.certificateStatus,
        };
      });
    },
    [],
  );

  const updateFilters = useCallback((patch: Partial<DashboardFilters>) => {
    setFiltersState((prev) => ({
      dateRange: patch.dateRange
        ? {
            from: patch.dateRange.from,
            to: patch.dateRange.to,
          }
        : prev.dateRange,
      meterIds: patch.meterIds ? [...patch.meterIds] : prev.meterIds,
      certificateStatus:
        patch.certificateStatus !== undefined
          ? patch.certificateStatus
          : prev.certificateStatus,
    }));
  }, []);

  const resetFilters = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    clearStoredFilters(userIdRef.current);
    setFiltersState(DEFAULT_DASHBOARD_FILTERS);
  }, []);

  return {
    filters,
    setFilters,
    updateFilters,
    resetFilters,
    isHydrated,
  };
}

export default usePersistentFilters;