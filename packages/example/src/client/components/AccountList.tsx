import { useState } from 'react';

interface Account {
  id: string;
  name: string;
  balance: number;
}

export function AccountList({
  accounts,
  onCreateAccount,
}: {
  accounts: Account[];
  onCreateAccount: (name: string, balance: number) => void;
}) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('1000');

  return (
    <div className="card">
      <h2>口座一覧</h2>
      <table>
        <thead>
          <tr>
            <th>名前</th>
            <th>残高</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td className="balance">{a.balance.toLocaleString()} 円</td>
              <td style={{ color: '#999', fontSize: '0.8rem' }}>
                {a.id.slice(0, 8)}
              </td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: '#999' }}>
                口座がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="form-row" style={{ marginTop: '1rem' }}>
        <input
          placeholder="名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="初期残高"
          type="number"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            onCreateAccount(name, Number(balance));
            setName('');
          }}
        >
          口座作成
        </button>
      </div>
    </div>
  );
}
