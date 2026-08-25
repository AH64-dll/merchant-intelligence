import { MerchantDb } from './db';
import { SearchIndex } from './search';

const DB_PATH = process.env.MERCHANTS_DB ?? './data/merchants.db';

let dbInstance: MerchantDb | null = null;
let indexInstance: SearchIndex | null = null;

export function getDb(): MerchantDb {
  if (dbInstance === null) {
    dbInstance = new MerchantDb(DB_PATH);
  }
  return dbInstance;
}

export function getIndex(): SearchIndex {
  if (indexInstance === null) {
    indexInstance = SearchIndex.fromDb(getDb());
  }
  return indexInstance;
}
