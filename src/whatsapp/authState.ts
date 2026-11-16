import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataTypeMap } from '@whiskeysockets/baileys';

class KeyedMutex {
  private queues = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    const tail = previous.then(() => current, () => current);
    this.queues.set(key, tail);

    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      releaseCurrent();
      if (this.queues.get(key) === tail) {
        this.queues.delete(key);
      }
    }
  }
}

let tempWriteCounter = 0;

/**
 * Substituto atômico para `useMultiFileAuthState` do Baileys.
 * Serializa operações por arquivo e grava via arquivo temporário + fsync + rename
 * para evitar corrupção de `creds.json` e chaves Signal em quedas ou reinícios.
 */
export async function useAtomicMultiFileAuthState(
  folder: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const folderInfo = await stat(folder).catch(() => null);
  if (folderInfo) {
    if (!folderInfo.isDirectory()) {
      throw new Error(`Existe um arquivo não-diretório no caminho de autenticação: ${folder}`);
    }
  } else {
    await mkdir(folder, { recursive: true });
  }

  const mutex = new KeyedMutex();
  const fixFileName = (file: string): string => file.replace(/\//g, '__').replace(/:/g, '-');

  const writeData = async (data: unknown, file: string): Promise<void> => {
    const filePath = path.join(folder, fixFileName(file));
    await mutex.runExclusive(filePath, async () => {
      const payload = JSON.stringify(data, BufferJSON.replacer);
      const tmpPath = `${filePath}.tmp-${process.pid}-${++tempWriteCounter}`;
      try {
        const fh = await open(tmpPath, 'w');
        try {
          await fh.writeFile(payload, 'utf-8');
          await fh.sync();
        } finally {
          await fh.close();
        }
        await rename(tmpPath, filePath);
      } catch (err) {
        await unlink(tmpPath).catch(() => {});
        throw err;
      }
    });
  };

  const readData = async (file: string): Promise<any | null> => {
    const filePath = path.join(folder, fixFileName(file));
    return mutex.runExclusive(filePath, async () => {
      let raw: string;
      try {
        raw = await readFile(filePath, { encoding: 'utf-8' });
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return null;
        }
        throw err;
      }

      try {
        return JSON.parse(raw, BufferJSON.reviver);
      } catch (err) {
        console.warn(`[AuthState] Arquivo de sessão corrompido ignorado (${fixFileName(file)}):`, err);
        return null;
      }
    });
  };

  const removeData = async (file: string): Promise<void> => {
    const filePath = path.join(folder, fixFileName(file));
    await mutex.runExclusive(filePath, async () => {
      try {
        await unlink(filePath);
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          throw err;
        }
      }
    });
  };

  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value) as any;
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const categoryEntries = data[category as keyof typeof data];
            if (!categoryEntries) continue;
            for (const id in categoryEntries) {
              const value = categoryEntries[id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData(creds, 'creds.json');
    }
  };
}
