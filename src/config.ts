import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import yaml from 'yaml';

dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  authDir: string;
  dbDir: string;
  mediaDir: string;
  configYamlPath: string;
  mcpApiKey?: string;
  dashboardPassword?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  readOnly: boolean;
  logLevel: string;
}

export interface YamlFilters {
  ignore_broadcast_status: boolean;
  ignore_groups_by_default: boolean;
  denylist_jids: string[];
  allowlist_jids: string[];
}

export interface YamlConfig {
  filters: YamlFilters;
  transcription: {
    provider: string;
    model: string;
    language: string;
  };
  retention: {
    media_retention_days: number;
  };
  sync: {
    history_sync_enabled: boolean;
    media_sync_days: number;
  };
}

const DEFAULT_YAML_CONFIG: YamlConfig = {
  filters: {
    ignore_broadcast_status: true,
    ignore_groups_by_default: false,
    denylist_jids: [],
    allowlist_jids: []
  },
  transcription: {
    provider: 'groq',
    model: 'whisper-large-v3-turbo',
    language: 'pt'
  },
  retention: {
    media_retention_days: 0 // 0 = sem expiração
  },
  sync: {
    history_sync_enabled: true,
    media_sync_days: 7
  }
};

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const authDir = path.join(dataDir, 'auth');
const dbDir = path.join(dataDir, 'db');
const mediaDir = path.join(dataDir, 'media');
const configYamlPath = path.join(dataDir, 'config.yaml');

// Garante que os diretórios essenciais existam
for (const dir of [dataDir, authDir, dbDir, mediaDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Cria config.yaml padrão se não existir
if (!fs.existsSync(configYamlPath)) {
  fs.writeFileSync(configYamlPath, yaml.stringify(DEFAULT_YAML_CONFIG), 'utf-8');
}

export function loadYamlConfig(): YamlConfig {
  try {
    if (fs.existsSync(configYamlPath)) {
      const content = fs.readFileSync(configYamlPath, 'utf-8');
      const parsed = yaml.parse(content);
      return { ...DEFAULT_YAML_CONFIG, ...parsed };
    }
  } catch (err) {
    console.error('Erro ao ler config.yaml, usando defaults:', err);
  }
  return DEFAULT_YAML_CONFIG;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '8765', 10),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  authDir,
  dbDir,
  mediaDir,
  configYamlPath,
  mcpApiKey: process.env.MCP_API_KEY || undefined,
  dashboardPassword: process.env.DASHBOARD_PASSWORD || undefined,
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  openaiApiKey: process.env.OPENAI_API_KEY || undefined,
  readOnly: process.env.READ_ONLY !== 'false',
  logLevel: process.env.LOG_LEVEL || 'info'
};
