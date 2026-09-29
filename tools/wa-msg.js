'use strict';
// Apagar mensagens do grupo PRA TODOS, via API (usa os IDs que o bot passou a guardar).
// Uso:
//   node tools/wa-msg.js list [N]         -> lista os últimos N envios (default 15)
//   node tools/wa-msg.js delete <wa_id>   -> apaga essa mensagem pra todos
//   node tools/wa-msg.js delete-last [N]  -> apaga os últimos N envios pra todos
const db = require('../src/db');
const evolution = require('../src/evolution');

const fmt = (r) => `${r.sent_at}  ${(r.tag || '').padEnd(10)} #${r.wa_id}  ${(r.text || '').replace(/\n/g, ' ').slice(0, 55)}`;

async function delOne(r) {
  if (!r) { console.log('  (não encontrada)'); return false; }
  try {
    await evolution.deleteForEveryone({ id: r.wa_id, remoteJid: r.remote_jid, fromMe: !!r.from_me });
    db.sentMsgs.remove(r.wa_id);
    console.log(`  ✓ apagada pra todos: #${r.wa_id} (${r.tag || ''})`);
    return true;
  } catch (e) { console.log(`  ✗ falha #${r.wa_id} :: ${e.message}`); return false; }
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd || cmd === 'list') {
    const rows = db.sentMsgs.recent(parseInt(arg || '15', 10));
    if (!rows.length) console.log('(nenhum envio registrado ainda)');
    rows.forEach((r) => console.log(fmt(r)));
  } else if (cmd === 'delete') {
    await delOne(db.sentMsgs.get(arg));
  } else if (cmd === 'delete-last') {
    const rows = db.sentMsgs.recent(parseInt(arg || '1', 10));
    console.log(`apagando os últimos ${rows.length}...`);
    for (const r of rows) await delOne(r);
  } else {
    console.log('uso: list [N] | delete <wa_id> | delete-last [N]');
  }
  process.exit(0);
})();
