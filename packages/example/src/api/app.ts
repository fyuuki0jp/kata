import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDatabase } from '../infra/db';
import { AccountRepository, TransferRepository } from '../infra/repository';
import { accountRoutes } from './accounts';
import { transferRoutes } from './transfers';

export function createApp(dbPath?: string) {
  const db = createDatabase(dbPath);
  const accountRepo = new AccountRepository(db);
  const transferRepo = new TransferRepository(db);

  const app = new Hono();
  app.use('/*', cors());

  app.route('/api/accounts', accountRoutes(accountRepo));
  app.route('/api/transfers', transferRoutes(accountRepo, transferRepo));

  return { app, db };
}
