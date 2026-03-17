import { Hono } from 'hono';
import type { AccountRepository } from '../infra/repository';

export function accountRoutes(repo: AccountRepository) {
  const app = new Hono();

  app.get('/', (c) => {
    const accounts = repo.findAll();
    return c.json(accounts);
  });

  app.get('/:id', (c) => {
    const account = repo.findById(c.req.param('id'));
    if (!account) return c.json({ error: 'Not found' }, 404);
    return c.json(account);
  });

  app.post('/', async (c) => {
    const body = await c.req.json<{ name: string; balance?: number }>();
    const account = repo.create(body.name, body.balance ?? 0);
    return c.json(account, 201);
  });

  return app;
}
