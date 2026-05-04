import { useEffect, useState } from 'react';

import { fetchAccountSummary, type AccountSummary } from '@/services/api/account';
import { useAppSession } from '@/services/auth/AppSessionProvider';

export function useAccountSummary() {
  const session = useAppSession();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session.session || session.status !== 'authenticated') {
        setSummary(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const next = await fetchAccountSummary(session.session);
        if (!cancelled) {
          setSummary(next);
        }
      } catch (err) {
        if (!cancelled) {
          setSummary(null);
          setError(err instanceof Error ? err.message : 'Account summary failed');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [session.session, session.status]);

  return { summary, loading, error };
}
