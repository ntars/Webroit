/**
 * 快照的 IndexedDB 落盘实现（浏览器专属）。
 *
 * 从 snapshot.ts 拆出来是被命令行侧逼出来的：
 * Node 里没有 indexedDB / IDBDatabase，原先的写法让整个 core 层都带着浏览器痕迹，
 * 一旦要在命令行复用 services，compiler 立刻报 Cannot find name 'indexedDB'。
 * 拆开后 snapshot.ts 只剩纯逻辑，这个文件只在浏览器入口 import。
 *
 * 行为与拆分前完全一致：同一个库名、同一个 store、同一次只留本次会话的清理。
 */

import type { SnapshotBackend, SnapshotEntry } from '@/core/snapshot';

const DB_NAME = 'webroit-snapshots';
const STORE = 'entries';

/** 打开数据库。onupgradeneeded 里建表，首次访问时自动创建 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('at', 'at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 创建后端实例，同时创建数据库连接 */
export async function createIndexedDbBackend(): Promise<SnapshotBackend> {
  const db = await openDatabase();

  return {
    async readAll(): Promise<SnapshotEntry[]> {
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).getAll();
        request.onsuccess = () => resolve((request.result as SnapshotEntry[]) ?? []);
        request.onerror = () => resolve([]);
      });
    },

    async put(entry: SnapshotEntry): Promise<void> {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
    },

    async remove(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const id of ids) store.delete(id);
    },
  };
}

/**
 * 初始化并注册 IndexedDB 后端。
 *
 * 失败时保持纯内存模式：隐私窗口、配额耗尽都不该让玩机功能不可用，
 * 只是刷新后丢掉快照 —— 这一点在快照面板上已有提示。
 */
export async function installIndexedDbBackend(
  register: (backend: SnapshotBackend | null) => void,
): Promise<void> {
  try {
    register(await createIndexedDbBackend());
  } catch {
    register(null);
  }
}
