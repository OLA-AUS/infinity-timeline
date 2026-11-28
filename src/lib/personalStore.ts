// Where personal spaces are kept: IndexedDB, inside this browser, on this device only.
//
// One database, one object store, one record per space (the whole space, history included).
// There is deliberately no network code here or anywhere near it: no sync, no accounts, no
// analytics. If IndexedDB isn't available (some private-browsing modes), spaces live in
// memory for this visit and the app says so — they are never sent anywhere instead.
import type { PersonalSpace } from './personal';

const DB_NAME = 'infinity-timeline-personal';
const DB_VERSION = 1;
const STORE = 'spaces';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no IndexedDB.'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open local storage.'));
      req.onblocked = () => reject(new Error('Local storage is busy in another tab.'));
    });
    dbPromise.catch(() => { dbPromise = null; }); // allow a retry later
  }
  return dbPromise;
}

/** Run one request in a transaction and wait for the transaction to finish. */
async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Local storage failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Local storage was interrupted.'));
  });
}

/** Every space on this device, oldest first (so lanes keep their order). */
export async function loadSpaces(): Promise<PersonalSpace[]> {
  const all = await run<PersonalSpace[]>('readonly', (s) => s.getAll() as IDBRequest<PersonalSpace[]>);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Save (add or replace) one space. */
export async function saveSpace(space: PersonalSpace): Promise<void> {
  await run('readwrite', (s) => s.put(space));
}

/** Wipe one space from this device. The caller asks the user first and offers an export. */
export async function deleteSpace(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
