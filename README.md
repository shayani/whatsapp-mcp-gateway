# WhatsApp Gateway & MCP Server

A containerized gateway built with **TypeScript (Node.js 22)** that connects your WhatsApp account through **Baileys**, stores and indexes messages and media in a local **SQLite (WAL + FTS5)** database, provides **asynchronous audio transcription with Whisper (Groq/OpenAI)**, and exposes queries to AI agents (Claude, Cursor, Antigravity, etc.) exclusively through the **Model Context Protocol (MCP)**.

The application also includes an **integrated web dashboard** on port `8765` for browsing messages, searching across conversations, and enabling or disabling message collection for individual contacts and groups with a single click.

---

## 🚀 Getting Started in Production (Docker)

Docker Compose is the standard way to run the application.

### 1. Create the `.env` file

Copy the example file and configure the variables as needed:

```bash
cp .env.example .env
```

*(You can also enter your Groq API key through the web interface after the container starts.)*

### 2. Start the container

```bash
docker compose up -d --build
```

### 3. Link your WhatsApp account

You can access the QR code in two ways:

1. **Web interface** (recommended): Open `http://localhost:8765/auth` in your browser.
2. **Terminal**: View the QR code in the logs:
   ```bash
   docker compose logs -f whatsapp-gateway
   ```

Open WhatsApp on your smartphone, go to **Linked devices** > **Link a device**, and scan the QR code.

You are ready to go! Incoming messages will pass through the collection filter, and matching messages will be stored in SQLite at `./data/db/whatsapp.db`.

---

## 🖥️ Integrated Web Dashboard (`:8765`)

Open **`http://localhost:8765`** in your browser.

- **Chat list**: Displays contacts and groups with the time of their most recent message.
- **Collection toggle ("Coletar / Ignorar", meaning "Collect / Ignore")**: Click the switch next to a contact or group to enable or disable collection in real time. This immediately updates both the database and the Baileys filter.
- **Global search (FTS5)**: Use the search field at the top to search for keywords across all messages and voice transcriptions at once.
- **History and transcriptions**: Browse chat bubbles with highlighted audio message transcriptions.
- **Settings**: Click the key icon in the top corner to enter or update your Groq API key (`gsk_...`).

---

## 🤖 Connecting Your AI Agents via MCP

The MCP server uses the **HTTP / Server-Sent Events (SSE)** transport at:
`http://localhost:8765/sse`

### Claude Desktop Configuration Example

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whatsapp-gateway": {
      "url": "http://localhost:8765/sse"
    }
  }
}
```

### Cursor / Antigravity Configuration Example

In the MCP settings, use:

- **Type**: `sse`
- **URL**: `http://localhost:8765/sse`

---

## 🛠️ Available MCP Tools

| Tool | Description |
| :--- | :--- |
| `list_chats` | Lists recent chats with their JID, name, date, and collection status. |
| `get_chat_history` | Returns a contact's message history in chronological order, including attachments and audio transcriptions. |
| `search_messages` | Performs indexed full-text searches across message text and audio transcriptions using SQLite FTS5. |
| `get_attachment_info` | Returns details and the local file path of downloaded media. |
| `get_contact_info` | Returns metadata for a contact or group. |

---

## 📁 Persistent Directory Structure (`./data`)

All application state is mapped to the `./data` directory:

```text
./data/
├── auth/         # WhatsApp session credentials (creds.json)
├── db/           # SQLite database (whatsapp.db and WAL)
├── media/        # Downloaded media and audio files
└── config.yaml   # Global settings and default lists
```
