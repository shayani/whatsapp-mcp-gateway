# WhatsApp Gateway & MCP Server

Gateway containerizado em **TypeScript (Node.js 22)** para conectar sua conta do WhatsApp via **Baileys**, salvar e indexar mensagens e mídias em banco de dados local **SQLite (WAL + FTS5)**, realizar **transcrição assíncrona de áudios via Whisper (Groq/OpenAI)** e disponibilizar consultas exclusivamente via **Model Context Protocol (MCP)** para agentes de IA (Claude, Cursor, Antigravity, etc.).

A aplicação inclui também um **Dashboard Web integrado** na porta `8765` para consulta de mensagens, busca global e ativação/desativação da coleta de contatos e grupos com um clique.

---

## 🚀 Como Iniciar em Produção (Docker)

O modo nativo de execução é via Docker Compose.

### 1. Criar arquivo `.env`
Copie o exemplo e configure as variáveis desejadas:
```bash
cp .env.example .env
```
*(Você também pode inserir a chave da Groq diretamente pela interface web depois que o container subir).*

### 2. Subir o container
```bash
docker compose up -d --build
```

### 3. Parear com o WhatsApp
Você tem duas formas de escanear o QR Code:
1. **Pela Interface Web** (Recomendado): Acesse `http://localhost:8765/auth` no seu navegador.
2. **Pelo Terminal**: Visualize o QR Code nos logs:
   ```bash
   docker compose logs -f whatsapp-gateway
   ```
Abra o WhatsApp no seu smartphone > **Aparelhos conectados** > **Conectar aparelho** e aponte para o QR Code.

Pronto! Todas as mensagens recebidas passarão pelo filtro na borda e serão persistidas no SQLite em `./data/db/whatsapp.db`.

---

## 🖥️ Dashboard Web Integrado (`:8765`)

Acesse no navegador: **`http://localhost:8765`**

- **Lista de Conversas**: Exibe contatos e grupos com horário da última mensagem.
- **Toggle Liga/Desliga ("Coletar / Ignorar")**: Ao lado de cada contato ou grupo, clique no switch para habilitar ou desabilitar a coleta em tempo real (atualiza o banco e o filtro do Baileys na hora).
- **Busca Global (FTS5)**: Pesquise palavras-chave em todas as mensagens e transcrições de voz simultaneamente no topo.
- **Histórico e Transcrições**: Visualize balões de conversa com as transcrições das mensagens de áudio em destaque.
- **Configurações**: Clique no ícone de chave no canto superior para inserir ou atualizar sua chave de API da Groq (`gsk_...`).

---

## 🤖 Conectando seus Agentes via MCP

O servidor MCP roda nativamente via transporte **HTTP / Server-Sent Events (SSE)** em:
`http://localhost:8765/sse`

### Exemplo de Configuração para Claude Desktop
Adicione ao seu `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "whatsapp-gateway": {
      "url": "http://localhost:8765/sse"
    }
  }
}
```

### Exemplo de Configuração para Cursor / Antigravity
Nas configurações de MCP:
- **Type**: `sse`
- **URL**: `http://localhost:8765/sse`

---

## 🛠️ Catálogo de Ferramentas MCP Disponíveis

| Ferramenta | Descrição |
| :--- | :--- |
| `list_chats` | Lista conversas recentes com JID, nome, data e status de coleta. |
| `get_chat_history` | Retorna histórico de mensagens cronológico de um contato com anexos e transcrições de áudio. |
| `search_messages` | Busca full-text indexada via SQLite FTS5 no conteúdo de textos e áudios. |
| `get_attachment_info` | Detalhes e caminho local em disco de mídias baixadas. |
| `get_contact_info` | Metadados de cadastro de um contato ou grupo. |

---

## 📁 Estrutura de Diretórios Persistentes (`./data`)

Todo o estado da aplicação fica mapeado na pasta `./data`:
```text
./data/
├── auth/         # Credenciais da sessão do WhatsApp (creds.json)
├── db/           # Banco de dados SQLite (whatsapp.db e WAL)
├── media/        # Mídias e áudios baixados
└── config.yaml   # Configurações globais e listas padrão
```
