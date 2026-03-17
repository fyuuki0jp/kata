import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Account, Transfer } from '../domain/types';

export class AccountRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): Account[] {
    return this.db
      .prepare('SELECT id, name, balance FROM accounts')
      .all() as Account[];
  }

  findById(id: string): Account | undefined {
    return this.db
      .prepare('SELECT id, name, balance FROM accounts WHERE id = ?')
      .get(id) as Account | undefined;
  }

  create(name: string, initialBalance: number): Account {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)')
      .run(id, name, initialBalance);
    return { id, name, balance: initialBalance };
  }

  updateBalance(id: string, newBalance: number): void {
    this.db
      .prepare('UPDATE accounts SET balance = ? WHERE id = ?')
      .run(newBalance, id);
  }
}

export class TransferRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): Transfer[] {
    return this.db
      .prepare(
        'SELECT id, from_id as fromId, to_id as toId, amount, status, created_at as createdAt FROM transfers ORDER BY created_at DESC'
      )
      .all() as Transfer[];
  }

  create(
    fromId: string,
    toId: string,
    amount: number,
    status: string
  ): Transfer {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO transfers (id, from_id, to_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, fromId, toId, amount, status, createdAt);
    return {
      id,
      fromId,
      toId,
      amount,
      status: status as 'completed' | 'failed',
      createdAt,
    };
  }
}
