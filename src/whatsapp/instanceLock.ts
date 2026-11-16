import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export class InstanceLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceLockError';
  }
}

export interface InstanceLock {
  lockPath: string;
  release: () => void;
}

interface LockPayload {
  pid: number;
  hostname: string;
  instanceId: string;
  startedAt: number;
  updatedAt: number;
}

export interface AcquireInstanceLockOptions {
  /** Tempo máximo (ms) para considerar um lock de outro host/container como obsoleto. Padrão: 30s. */
  staleMs?: number;
  /** Intervalo (ms) de atualização do heartbeat no arquivo de lock. Padrão: 10s. */
  heartbeatMs?: number;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM significa que o processo existe, porém pertence a outro usuário
    return err?.code === 'EPERM';
  }
}

function readLockPayload(lockPath: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as Partial<LockPayload>;
    if (typeof parsed.pid === 'number' && typeof parsed.hostname === 'string') {
      return {
        pid: parsed.pid,
        hostname: parsed.hostname,
        instanceId: typeof parsed.instanceId === 'string' ? parsed.instanceId : '',
        startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writePayloadAtomic(lockPath: string, payload: LockPayload): void {
  const tmpPath = `${lockPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
  fs.renameSync(tmpPath, lockPath);
}

/**
 * Adquire um lock exclusivo por diretório de dados (`gateway.lock`) para impedir
 * que duas instâncias do gateway acessem o mesmo `data/auth` simultaneamente.
 */
export function acquireInstanceLock(
  lockDir: string,
  options: AcquireInstanceLockOptions = {}
): InstanceLock {
  const staleMs = options.staleMs ?? 30_000;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const lockPath = path.join(lockDir, 'gateway.lock');
  const hostname = os.hostname();
  const instanceId = crypto.randomUUID();

  fs.mkdirSync(lockDir, { recursive: true });

  const createLock = (attempt = 0): void => {
    const now = Date.now();
    const payload: LockPayload = {
      pid: process.pid,
      hostname,
      instanceId,
      startedAt: now,
      updatedAt: now
    };

    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify(payload), undefined, 'utf-8');
      } finally {
        fs.closeSync(fd);
      }
      return;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') {
        throw err;
      }
    }

    const existing = readLockPayload(lockPath);
    if (existing) {
      const sameHost = existing.hostname === hostname;
      if (sameHost) {
        if (existing.pid !== process.pid && isPidAlive(existing.pid)) {
          throw new InstanceLockError(
            `Outra instância do WhatsApp Gateway já está em execução (PID ${existing.pid}) usando ${lockDir}.`
          );
        }
      } else {
        const ageMs = Date.now() - (existing.updatedAt || existing.startedAt || 0);
        if (ageMs >= 0 && ageMs < staleMs) {
          throw new InstanceLockError(
            `Outra instância do WhatsApp Gateway (${existing.hostname}, PID ${existing.pid}) está ativa em ${lockDir}.`
          );
        }
      }
    }

    if (attempt >= 2) {
      throw new InstanceLockError(`Não foi possível adquirir o lock exclusivo em ${lockPath}.`);
    }

    // Remove lock obsoleto/corrompido e tenta novamente
    try {
      fs.unlinkSync(lockPath);
    } catch (unlinkErr: any) {
      if (unlinkErr?.code !== 'ENOENT') {
        throw unlinkErr;
      }
    }

    createLock(attempt + 1);
  };

  createLock();

  let released = false;
  const heartbeatTimer = setInterval(() => {
    if (released) return;
    try {
      const current = readLockPayload(lockPath);
      if (current && current.instanceId === instanceId) {
        writePayloadAtomic(lockPath, {
          ...current,
          updatedAt: Date.now()
        });
      }
    } catch {
      // Ignora erro transitório no heartbeat
    }
  }, heartbeatMs);
  heartbeatTimer.unref();

  return {
    lockPath,
    release: () => {
      if (released) return;
      released = true;
      clearInterval(heartbeatTimer);
      try {
        const current = readLockPayload(lockPath);
        if (!current || current.instanceId === instanceId) {
          fs.unlinkSync(lockPath);
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.warn('[InstanceLock] Falha ao remover arquivo de lock:', err);
        }
      }
    }
  };
}
