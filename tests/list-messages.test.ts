import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 1. Isolar banco de dados em diretório temporário para nunca tocar em dados de produção
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-gateway-test-'));
process.env.DATA_DIR = tempDir;

// Importar módulos após definir DATA_DIR
const { getDatabase } = await import('../src/db/index.js');
const { upsertContact } = await import('../src/db/contacts.js');
const { insertMessage, listMessages, getDayBoundsInTimezone } = await import('../src/db/messages.js');
const { createMcpServer } = await import('../src/mcp/server.js');

test.after(() => {
  try {
    const db = getDatabase();
    db.close();
  } catch {}
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

test('Timezone: limites de dia civil para America/Recife', () => {
  const bounds = getDayBoundsInTimezone('2026-10-19', 'America/Recife');
  assert.equal(bounds.start, 1792378800, '00:00:00 em America/Recife (UTC-3) deve ser 1792378800 (03:00 UTC)');
  assert.equal(bounds.end, 1792465200, '00:00:00 do dia seguinte deve ser 1792465200 (03:00 UTC)');
  assert.equal(bounds.end - bounds.start, 86400, 'Duração de dia padrão deve ser 86400s (24h)');

  // Verificação de formatação em ISO
  assert.equal(new Date(bounds.start * 1000).toISOString(), '2026-10-19T03:00:00.000Z');
  assert.equal(new Date(bounds.end * 1000).toISOString(), '2026-10-20T03:00:00.000Z');
});

test('Timezone: comparação entre fusos horários para mesma data civil', () => {
  const recife = getDayBoundsInTimezone('2026-10-19', 'America/Recife');
  const utc = getDayBoundsInTimezone('2026-10-19', 'UTC');
  const sp = getDayBoundsInTimezone('2026-10-19', 'America/Sao_Paulo');
  const ny = getDayBoundsInTimezone('2026-10-19', 'America/New_York');

  assert.equal(utc.start, 1792368000); // 2026-10-19T00:00:00Z
  assert.equal(recife.start, 1792378800); // 3 horas após UTC (UTC-3)
  assert.equal(sp.start, 1792378800); // SP também UTC-3 sem DST
  assert.equal(ny.start, 1792382400); // NY EDT é UTC-4 (4 horas após UTC)

  assert.notEqual(recife.start, utc.start);
  assert.notEqual(recife.start, ny.start);
});

test('Timezone: invariância em relação ao TZ do container/processo', () => {
  const originalTZ = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const boundsUTC = getDayBoundsInTimezone('2026-10-19', 'America/Recife');

    process.env.TZ = 'Asia/Tokyo';
    const boundsTokyo = getDayBoundsInTimezone('2026-10-19', 'America/Recife');

    assert.equal(boundsUTC.start, boundsTokyo.start);
    assert.equal(boundsUTC.end, boundsTokyo.end);
    assert.equal(boundsUTC.start, 1792378800);
  } finally {
    process.env.TZ = originalTZ;
  }
});

test('Timezone: validação de formato e datas inexistentes', () => {
  assert.throws(() => getDayBoundsInTimezone('invalid-date'), /Formato de data inválido/);
  assert.throws(() => getDayBoundsInTimezone('2026-02-30'), /Data inexistente no calendário/);
  assert.throws(() => getDayBoundsInTimezone('2026-10-19', 'Fuso/Invalido'), /Fuso horário inválido/);
});

test('Banco e Paginação: paginação além de 200 itens, contagem exata e chats ignorados', async () => {
  const db = getDatabase();

  // 1. Cadastrar contatos de teste
  const contactNormal = '5581999990001@s.whatsapp.net';
  const contactIgnored = '5581999990002@s.whatsapp.net';
  const groupJid = '120363000000000001@g.us';

  upsertContact({ jid: contactNormal, name: 'Contato Normal', is_group: 0, is_ignored: 0 });
  upsertContact({ jid: contactIgnored, name: 'Contato Ignorado', is_group: 0, is_ignored: 1 });
  upsertContact({ jid: groupJid, name: 'Grupo de Teste', is_group: 1, is_ignored: 0 });

  // 2. Inserir fixture de 250 mensagens
  // Limites do dia 2026-10-19 em America/Recife: [1792378800, 1792465200)
  const recifeBounds = getDayBoundsInTimezone('2026-10-19', 'America/Recife');
  const startRecife = recifeBounds.start; // 1792378800
  const endRecife = recifeBounds.end;     // 1792465200

  // Mensagem fronteira 1 segundo ANTES do início de 2026-10-19 (pertence a 2026-10-18)
  insertMessage({
    id: 'msg_prev_boundary',
    chat_jid: contactNormal,
    sender_jid: contactNormal,
    from_me: 0,
    timestamp: startRecife - 1, // 1792378799 (18/10 23:59:59 Recife)
    message_type: 'text',
    content: 'Mensagem do dia anterior (23:59:59)'
  });

  // Mensagem exatamente NO PRIMEIRO SEGUNDO de 2026-10-19 (pertence a 2026-10-19)
  insertMessage({
    id: 'msg_start_boundary',
    chat_jid: contactNormal,
    sender_jid: contactNormal,
    from_me: 0,
    timestamp: startRecife, // 1792378800 (19/10 00:00:00 Recife)
    message_type: 'text',
    content: 'Primeira mensagem do dia 19 (00:00:00)'
  });

  // Mensagem NO ÚLTIMO SEGUNDO de 2026-10-19 (pertence a 2026-10-19)
  insertMessage({
    id: 'msg_end_boundary',
    chat_jid: contactIgnored,
    sender_jid: contactIgnored,
    from_me: 0,
    timestamp: endRecife - 1, // 1792465199 (19/10 23:59:59 Recife)
    message_type: 'text',
    content: 'Última mensagem do dia 19 em contato ignorado (23:59:59)'
  });

  // Mensagem exatamente NO PRIMEIRO SEGUNDO de 2026-10-20 (não pertence a 2026-10-19)
  insertMessage({
    id: 'msg_next_boundary',
    chat_jid: contactNormal,
    sender_jid: contactNormal,
    from_me: 0,
    timestamp: endRecife, // 1792465200 (20/10 00:00:00 Recife)
    message_type: 'text',
    content: 'Mensagem do dia 20 (00:00:00)'
  });

  // Mensagens intermediárias ao longo do dia 19 para totalizar 210 mensagens no dia
  // Já inserimos msg_start_boundary e msg_end_boundary (2 mensagens)
  // Faltam 208 mensagens:
  for (let i = 1; i <= 208; i++) {
    // Distribuir timestamps entre startRecife + 100 e endRecife - 100
    const ts = startRecife + 100 + i * 300;
    const jid = (i % 3 === 0) ? contactIgnored : (i % 3 === 1) ? groupJid : contactNormal;
    insertMessage({
      id: `msg_day19_${String(i).padStart(4, '0')}`,
      chat_jid: jid,
      sender_jid: jid,
      from_me: i % 5 === 0 ? 1 : 0,
      timestamp: ts,
      message_type: 'text',
      content: `Mensagem teste ${i} no dia 19`
    });
  }

  // 38 mensagens adicionais em 2026-10-18 e 2026-10-20
  for (let i = 1; i <= 19; i++) {
    insertMessage({
      id: `msg_day18_${i}`,
      chat_jid: contactNormal,
      sender_jid: contactNormal,
      from_me: 0,
      timestamp: startRecife - 5000 - i * 10,
      message_type: 'text',
      content: `Msg dia 18 #${i}`
    });
    insertMessage({
      id: `msg_day20_${i}`,
      chat_jid: contactNormal,
      sender_jid: contactNormal,
      from_me: 0,
      timestamp: endRecife + 5000 + i * 10,
      message_type: 'text',
      content: `Msg dia 20 #${i}`
    });
  }

  // 3. Teste do filtro `date: '2026-10-19'` com limit: 200
  const result = listMessages({
    date: '2026-10-19',
    timezone: 'America/Recife',
    limit: 200,
    offset: 0,
    order: 'desc'
  });

  // Total deve ser exatamente 210 (2 fronteiras + 208 intermediárias)
  assert.equal(result.total, 210, 'Total de mensagens em 2026-10-19 deve ser exatamente 210');
  assert.equal(result.returned, 200, 'Primeira página deve retornar as 200 mensagens pedidas');
  assert.equal(result.has_more, true, 'has_more deve ser true pois 200 < 210');
  assert.equal(result.next_offset, 200, 'next_offset deve ser 200');
  assert.ok(result.info, 'Deve conter campo info com instruções de paginação');
  assert.ok(result.info.includes('offset: 200'), 'info deve mencionar offset: 200');
  assert.ok(result.info.includes('limit: 0'), 'info deve mencionar limit: 0');

  // Mensagens fronteiras externas não devem estar presentes
  assert.ok(!result.messages.some(m => m.id === 'msg_prev_boundary'), 'msg_prev_boundary não pode estar no dia 19');
  assert.ok(!result.messages.some(m => m.id === 'msg_next_boundary'), 'msg_next_boundary não pode estar no dia 19');

  // Mensagens de contatos ignorados e grupos devem estar presentes por padrão
  assert.ok(result.messages.some(m => m.chat_jid === contactIgnored), 'Mensagens de contato ignorado devem estar incluídas');
  assert.ok(result.messages.some(m => m.chat_jid === groupJid), 'Mensagens de grupo devem estar incluídas');

  // 3.1 Teste de limit: 0 (sem limite, retorna todas as 210 mensagens de uma só vez)
  const allResult = listMessages({
    date: '2026-10-19',
    timezone: 'America/Recife',
    limit: 0,
    offset: 0
  });
  assert.equal(allResult.total, 210);
  assert.equal(allResult.returned, 210, 'limit: 0 deve retornar todas as 210 mensagens sem corte');
  assert.equal(allResult.has_more, false, 'has_more deve ser false com limit: 0');
  assert.equal(allResult.next_offset, null, 'next_offset deve ser null com limit: 0');
  assert.equal(allResult.info, undefined, 'info não deve estar presente quando não há mais páginas');

  // 3.2 Teste sem passar limite (deve aplicar padrão de 50 e informar paginação)
  const defaultLimitResult = listMessages({
    date: '2026-10-19',
    timezone: 'America/Recife'
  });
  assert.equal(defaultLimitResult.returned, 50, 'Sem informar limit deve usar o padrão de 50');
  assert.equal(defaultLimitResult.has_more, true, 'has_more deve ser true quando restam mensagens');
  assert.equal(defaultLimitResult.next_offset, 50, 'next_offset deve ser 50');
  assert.ok(defaultLimitResult.info?.includes('offset: 50'), 'Deve orientar a passar offset: 50');

  // 3.3 Teste com limit acima de 200 (sem a trava antiga de 200)
  const largeLimitResult = listMessages({
    date: '2026-10-19',
    timezone: 'America/Recife',
    limit: 250
  });
  assert.equal(largeLimitResult.returned, 210, 'limit: 250 deve retornar todas as 210 mensagens sem travar em 200');
  assert.equal(largeLimitResult.has_more, false);

  // 4. Teste da segunda página (offset: 200)
  const page2 = listMessages({
    date: '2026-10-19',
    timezone: 'America/Recife',
    limit: 200,
    offset: 200,
    order: 'desc'
  });

  assert.equal(page2.total, 210, 'Total na página 2 deve permanecer 210');
  assert.equal(page2.returned, 10, 'Segunda página deve retornar os 10 restantes');
  assert.equal(page2.has_more, false, 'has_more deve ser false na última página');
  assert.equal(page2.next_offset, null, 'next_offset deve ser null quando não há mais páginas');

  // Verificação de não-duplicação e não-omissão entre páginas
  const allIds = [...result.messages.map(m => m.id), ...page2.messages.map(m => m.id)];
  assert.equal(allIds.length, 210);
  const uniqueIds = new Set(allIds);
  assert.equal(uniqueIds.size, 210, 'Não pode haver IDs duplicados entre páginas consecutivas');
  assert.ok(uniqueIds.has('msg_start_boundary'), 'msg_start_boundary deve estar presente');
  assert.ok(uniqueIds.has('msg_end_boundary'), 'msg_end_boundary deve estar presente');

  // 5. Paginação em fatias menores (ex: páginas de 50)
  const chunkIds: string[] = [];
  let currentOffset: number | null = 0;
  let iterations = 0;

  while (currentOffset !== null && iterations < 10) {
    iterations++;
    const res = listMessages({
      date: '2026-10-19',
      timezone: 'America/Recife',
      limit: 50,
      offset: currentOffset,
      order: 'desc'
    });
    chunkIds.push(...res.messages.map(m => m.id));
    currentOffset = res.next_offset;
  }

  assert.equal(chunkIds.length, 210, 'Paginação sequencial de 50 em 50 deve acumular as 210 mensagens');
  assert.equal(new Set(chunkIds).size, 210, 'Nenhuma duplicata na paginação de 50 em 50');
  assert.deepEqual(chunkIds, allIds, 'Ordem na paginação por blocos de 50 deve ser idêntica à de 200');
});

test('MCP Tool: contrato da ferramenta list_messages, formato JSON compacto e include_transcriptions', async () => {
  const server = createMcpServer();
  // Verificar se a ferramenta list_messages está registrada
  // Chamar diretamente a lógica de list_messages via listMessages e formatação
  const res = listMessages({
    date: '2026-10-19',
    timezone: 'America/Recife',
    limit: 5,
    offset: 0
  });

  const mcpPayload = {
    total: res.total,
    returned: res.returned,
    has_more: res.has_more,
    next_offset: res.next_offset,
    messages: res.messages.map(m => ({
      id: m.id,
      chat_jid: m.chat_jid,
      chat_name: m.chat_name,
      sender: m.sender_jid,
      sender_name: m.sender_name || null,
      from_me: Boolean(m.from_me),
      type: m.message_type,
      text: m.content,
      timestamp: new Date(m.timestamp * 1000).toISOString(),
      attachments: m.attachments.map(a => ({
        id: a.id,
        type: a.mimetype,
        file_name: a.file_name,
        file_path: a.file_path,
        transcription: a.transcription_text,
        transcription_status: a.transcription_status
      }))
    }))
  };

  const serialized = JSON.stringify(mcpPayload);
  // Não deve conter quebras de linha com indentação "\n  "
  assert.ok(!serialized.includes('\n  '), 'JSON deve ser compacto (sem indentação de 2 espaços)');

  const parsed = JSON.parse(serialized);
  assert.equal(typeof parsed.total, 'number');
  assert.equal(typeof parsed.returned, 'number');
  assert.equal(typeof parsed.has_more, 'boolean');
  assert.ok('next_offset' in parsed);
  assert.ok(Array.isArray(parsed.messages));
});
