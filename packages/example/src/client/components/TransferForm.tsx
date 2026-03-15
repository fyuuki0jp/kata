import { useState } from 'react';

interface Account {
  id: string;
  name: string;
  balance: number;
}

export function TransferForm({
  accounts,
  onTransfer,
  message,
}: {
  accounts: Account[];
  onTransfer: (fromId: string, toId: string, amount: number) => void;
  message: { type: 'success' | 'error'; text: string } | null;
}) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('100');

  return (
    <div className="card">
      <h2>送金</h2>
      <div className="form-row">
        <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
          <option value="">送金元を選択</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.balance.toLocaleString()}円)
            </option>
          ))}
        </select>
        <span>→</span>
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">送金先を選択</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.balance.toLocaleString()}円)
            </option>
          ))}
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: '100px' }}
        />
        <span>円</span>
        <button
          type="button"
          onClick={() => onTransfer(fromId, toId, Number(amount))}
          disabled={!fromId || !toId || !amount}
        >
          送金
        </button>
      </div>
      {message && (
        <div className={message.type === 'success' ? 'success' : 'error'}>
          {message.text}
        </div>
      )}
    </div>
  );
}
