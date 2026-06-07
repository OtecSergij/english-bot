import { db, type DB } from './db';
import { createServices, type Services } from './services';

/** Dependencies injected into feature factories (design-doc.md §2). */
export interface AppDeps {
  db: DB;
  services: Services;
}

export function createDeps(): AppDeps {
  return { db, services: createServices() };
}
