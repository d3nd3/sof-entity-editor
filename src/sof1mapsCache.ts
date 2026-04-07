const DB_NAME = "sof-entity-editor";
const STORE = "sof1maps-zips";
const DB_VER = 1;

function normKey(relPath: string): string {
  return relPath.trim().replace(/^\/+/, "").toLowerCase();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onerror = () => rej(req.error);
    req.onsuccess = () => res(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
  });
}

type Row = { key: string; data: ArrayBuffer; at: number };

export async function readCachedZip(relPath: string): Promise<ArrayBuffer | undefined> {
  const key = normKey(relPath);
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const q = tx.objectStore(STORE).get(key);
    q.onsuccess = () => res((q.result as Row | undefined)?.data);
    q.onerror = () => rej(q.error);
  });
}

export async function writeCachedZip(relPath: string, data: ArrayBuffer): Promise<void> {
  const key = normKey(relPath);
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ key, data, at: Date.now() } as Row);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** Clear all cached map zips (e.g. from devtools: import { clearMapZipCache } from "./sof1mapsCache"). */
export async function clearMapZipCache(): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
