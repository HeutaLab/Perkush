// Everything is kept in IndexedDB on this device: several boards, the pads on each board
// (one record per pad) and each board's recorded beat. Version 1 held a single board's
// pads, so opening an old board moves those pads onto a first named board.

const DB_NAME = 'video-drum-board';
const VERSION = 2;
const FIRST_BOARD = { id: 'board-1', name: 'My board' };

let dbPromise = null;

function upgrade(db, oldVersion, tx) {
  if (oldVersion >= 2) return;
  const boards = db.objectStoreNames.contains('boards')
    ? tx.objectStore('boards')
    : db.createObjectStore('boards', { keyPath: 'id' });
  const meta = db.objectStoreNames.contains('meta')
    ? tx.objectStore('meta')
    : db.createObjectStore('meta', { keyPath: 'key' });
  const first = { ...FIRST_BOARD, created: Date.now(), loop: null };
  boards.put(first);
  meta.put({ key: 'currentBoard', value: first.id });

  if (!db.objectStoreNames.contains('pads')) {
    createPads(db);
    return;
  }
  // Carry version 1's pads (keyed by pad number) onto the first board.
  const old = tx.objectStore('pads').getAll();
  old.onsuccess = () => {
    const records = old.result || [];
    db.deleteObjectStore('pads');
    const store = createPads(db);
    for (const record of records) {
      store.put({ ...record, key: `${first.id}:${record.pad}`, board: first.id });
    }
  };
}

function createPads(db) {
  const store = db.createObjectStore('pads', { keyPath: 'key' });
  store.createIndex('board', 'board');
  return store;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('this browser has no IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction);
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

async function withStore(names, mode, fn, retry = true) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const req = fn(...[].concat(names).map((n) => tx.objectStore(n)));
      tx.oncomplete = () => resolve(req && !Array.isArray(req) ? req.result : (req || []).map((r) => r.result));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('the storage transaction was aborted'));
    });
  } catch (err) {
    // Safari can drop an idle connection (e.g. after the tab sat in the background).
    if (retry && err && err.name === 'InvalidStateError') {
      dbPromise = null;
      return withStore(names, mode, fn, false);
    }
    throw err;
  }
}

// ---- boards ----

export const loadBoards = () => withStore('boards', 'readonly', (boards) => boards.getAll());
export const saveBoard = (board) => withStore('boards', 'readwrite', (boards) => boards.put(board));

export const deleteBoard = (id) => withStore(['boards', 'pads'], 'readwrite', (boards, pads) => {
  boards.delete(id);
  const cursor = pads.index('board').openKeyCursor(IDBKeyRange.only(id));
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (!c) return;
    pads.delete(c.primaryKey);
    c.continue();
  };
  return cursor;
});

export async function currentBoardId() {
  const record = await withStore('meta', 'readonly', (meta) => meta.get('currentBoard'));
  return record ? record.value : null;
}

export const setCurrentBoardId = (id) =>
  withStore('meta', 'readwrite', (meta) => meta.put({ key: 'currentBoard', value: id }));

// ---- pads ----

export const loadPads = (board) =>
  withStore('pads', 'readonly', (pads) => pads.index('board').getAll(IDBKeyRange.only(board)));

export const savePad = (board, record) =>
  withStore('pads', 'readwrite', (pads) => pads.put({ ...record, key: `${board}:${record.pad}`, board }));

export const deletePad = (board, pad) =>
  withStore('pads', 'readwrite', (pads) => pads.delete(`${board}:${pad}`));

let persistRequested = false;

// Asks the browser not to evict the boards under storage pressure (best effort).
export function requestPersistence() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    // Not supported.
  }
}
