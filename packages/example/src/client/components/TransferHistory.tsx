interface Account {
  id: string;
  name: string;
}
interface Transfer {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  status: string;
  createdAt: string;
}

export function TransferHistory({
  transfers,
  accounts,
}: {
  transfers: Transfer[];
  accounts: Account[];
}) {
  const getName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="card">
      <h2>送金履歴</h2>
      <table>
        <thead>
          <tr>
            <th>送金元</th>
            <th>送金先</th>
            <th>金額</th>
            <th>状態</th>
            <th>日時</th>
          </tr>
        </thead>
        <tbody>
          {transfers.map((t) => (
            <tr key={t.id}>
              <td>{getName(t.fromId)}</td>
              <td>{getName(t.toId)}</td>
              <td>{t.amount.toLocaleString()} 円</td>
              <td className={`status-${t.status}`}>
                {t.status === 'completed' ? '完了' : '失敗'}
              </td>
              <td style={{ fontSize: '0.8rem', color: '#999' }}>
                {new Date(t.createdAt).toLocaleString('ja')}
              </td>
            </tr>
          ))}
          {transfers.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: '#999' }}>
                履歴がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
