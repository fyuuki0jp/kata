import { useCallback, useEffect, useState } from 'react';
import { AccountList } from './components/AccountList';
import { TransferForm } from './components/TransferForm';
import { TransferHistory } from './components/TransferHistory';

interface Account {
  id: string;
  name: string;
  balance: number;
}
interface Transfer {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  status: string;
  createdAt: string;
}

export function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    setAccounts(await res.json());
  }, []);

  const fetchTransfers = useCallback(async () => {
    const res = await fetch('/api/transfers');
    setTransfers(await res.json());
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchTransfers();
  }, [fetchAccounts, fetchTransfers]);

  const handleCreateAccount = async (name: string, balance: number) => {
    await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, balance }),
    });
    fetchAccounts();
  };

  const handleTransfer = async (
    fromId: string,
    toId: string,
    amount: number
  ) => {
    setMessage(null);
    const res = await fetch('/api/transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId, toId, amount }),
    });
    if (res.ok) {
      setMessage({ type: 'success', text: `${amount} 円の送金が完了しました` });
    } else {
      const err = await res.json();
      setMessage({
        type: 'error',
        text: `送金失敗: ${err.error?.type ?? 'unknown'}`,
      });
    }
    fetchAccounts();
    fetchTransfers();
  };

  return (
    <div className="container">
      <h1>seizu Example — 送金サービス</h1>
      <p style={{ color: '#777', marginBottom: '1rem' }}>
        形式仕様検証 (SMT + PBT) で正しさが証明されたドメインロジック
      </p>

      <AccountList accounts={accounts} onCreateAccount={handleCreateAccount} />
      <TransferForm
        accounts={accounts}
        onTransfer={handleTransfer}
        message={message}
      />
      <TransferHistory transfers={transfers} accounts={accounts} />
    </div>
  );
}
