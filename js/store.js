// The board lives in IndexedDB with one record per pad (key = pad index), so replacing or
// clearing a pad never touches the others.

const DB_NAME = 'video-drum-board';
const STORE = 'pads';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('this browser has no IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'pad' });
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function withStore(mode, fn, retry = true) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error('the storage transaction was aborted'));
    });
  } catch (err) {
    // Safari can drop an idle connection (e.g. after the tab sat in the background).
    if (retry && err && err.name === 'InvalidStateError') {
      dbPromise = null;
      return withStore(mode, fn, false);
    }
    throw err;
  }
}

export const loadPads = () => withStore('readonly', (store) => store.getAll());
export const savePad = (record) => withStore('readwrite', (store) => store.put(record));
export const deletePad = (pad) => withStore('readwrite', (store) => store.delete(pad));

let persistRequested = false;

// Asks the browser not to evict the board under storage pressure (best effort).
export function requestPersistence() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    // Not supported.
  }
}
