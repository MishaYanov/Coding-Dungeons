const databaseName = 'coding-dungeons-mobile';
const storeName = 'heroes';

function updateResult(value) {
  if (value && typeof value.then === 'function') throw new TypeError('Hero updates must be synchronous.');
  return value;
}

export function createMobileRepository(indexedDB = globalThis.indexedDB, worldId = 'javascript') {
  const name = worldId === 'javascript' ? databaseName : `${databaseName}-${worldId}`;
  let database;

  function open() {
    if (!database) {
      database = new Promise((resolve, reject) => {
        if (!indexedDB) return reject(new Error('This browser has disabled local game storage.'));
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName, {keyPath:'hero.id'});
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            database = undefined;
          };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
      });
      database.catch(() => { database = undefined; });
    }
    return database;
  }

  async function run(mode, read, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      let originalError;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(originalError ?? transaction.error ?? new Error('Could not save the hero.'));
      const request = read(store);
      request.onsuccess = () => {
        try {
          result = updateResult(action(request.result, store));
        } catch (error) {
          originalError = error;
          transaction.abort();
        }
      };
    });
  }

  return {
    get: id => run('readonly', store => store.get(id), value => value),
    list: () => run('readonly', store => store.getAll(), values => values),
    create: (record, check) => run('readwrite', store => store.getAll(), (values, store) => {
      check(values);
      store.add(record);
    }),
    mutate: (id, update, check) => {
      const read = store => check ? store.getAll() : store.get(id);
      return run('readwrite', read, (value, store) => {
        const record = check ? value.find(item => item.hero.id === id) : value;
        if (!record) throw new Error('Hero not found.');
        const result = updateResult(update(record));
        if (check) check(value);
        store.put(record);
        return result;
      });
    },
    remove: id => run('readwrite', store => store.getKey(id), (key, store) => {
      if (key === undefined) return false;
      store.delete(id);
      return true;
    }),
    importEmpty: records => run('readwrite', store => store.count(), (count, store) => {
      if (count) throw new Error('Restore requires an empty world. Export your current heroes first.');
      for (const record of records) store.add(record);
    }),
  };
}
