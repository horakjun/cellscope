/* CellScope – úložiště v prohlížeči (IndexedDB): zákazníci, měření, nastavení.
   Data zůstávají jen na tomto PC; zálohu lze exportovat do souboru a načíst jinde. */
(function (root) {
  "use strict";
  const DB = "cellscope", VER = 1;
  let dbp = null;
  const mem = { customers: new Map(), measurements: new Map(), settings: new Map() };   // náhrada, když IndexedDB nejde

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const r = indexedDB.open(DB, VER);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore("customers", { keyPath: "id" });
          const m = db.createObjectStore("measurements", { keyPath: "id" });
          m.createIndex("cust", "custId");
          db.createObjectStore("settings", { keyPath: "key" });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) return fn(null, mem[store]);
    const t = db.transaction(store, mode);
    const out = await fn(t.objectStore(store), null);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    return out;
  }

  const S = {
    all: store => tx(store, "readonly", (s, m) => s ? req(s.getAll()) : [...m.values()]),
    get: (store, id) => tx(store, "readonly", (s, m) => s ? req(s.get(id)) : m.get(id)),
    put: (store, obj) => tx(store, "readwrite", (s, m) => { if (s) s.put(obj); else m.set(obj.id ?? obj.key, obj); return obj; }),
    del: (store, id) => tx(store, "readwrite", (s, m) => { if (s) s.delete(id); else m.delete(id); }),
    async setting(key, def) { const r = await S.get("settings", key); return r ? r.val : def; },
    setSetting: (key, val) => S.put("settings", { key, val }),
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),

    async exportAll() {
      return { app: "CellScope", version: 1, exported: new Date().toISOString(),
        customers: await S.all("customers"), measurements: await S.all("measurements") };
    },
    async importAll(o) {
      if (!o || o.app !== "CellScope" || !Array.isArray(o.customers) || !Array.isArray(o.measurements)) throw new Error("BAD");
      for (const c of o.customers) await S.put("customers", c);
      for (const m of o.measurements) await S.put("measurements", m);
      return { c: o.customers.length, m: o.measurements.length };
    }
  };
  root.CSStore = S;
})(window);
