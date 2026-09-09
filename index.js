const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const AUTH_DIR = process.env.WHATSAPP_AUTH_PATH || path.join(DATA_DIR, '.wwebjs_auth');
const BAN_FILE = path.join(DATA_DIR, 'banned.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadBans() {
  try {
    const raw = fs.readFileSync(BAN_FILE, 'utf8');
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list : []);
  } catch (_) {
    return new Set();
  }
}
function saveBans() {
  fs.writeFileSync(BAN_FILE, JSON.stringify([...bannedNumbers].sort(), null, 2));
}
function normalizeNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}
function numberFromId(id) {
  return normalizeNumber(String(id || '').split('@')[0]);
}

const bannedNumbers = loadBans();
const warnings = new Map();
const spam = new Map();
const botSignals = new Map();
let latestQr = null;
let botReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-moderator', dataPath: AUTH_DIR }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', async qr => {
  latestQr = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
  botReady = false;
  console.log('New WhatsApp QR available at /qr');
});
client.on('authenticated', () => console.log('WhatsApp authenticated.'));
client.on('ready', () => { botReady = true; latestQr = null; console.log('WhatsApp bot is READY.'); });
client.on('auth_failure', msg => console.error('Authentication failure:', msg));
client.on('disconnected', reason => { botReady = false; console.log('WhatsApp disconnected:', reason); });

async function getChat(message) { return message.getChat(); }
async function isAdmin(message) {
  const chat = await getChat(message);
  if (!chat.isGroup) return false;
  const contact = await message.getContact();
  const participant = chat.participants.find(p => p.id._serialized === contact.id._serialized);
  return Boolean(participant && participant.isAdmin);
}
async function send(chat, text, mentions = []) {
  try { await chat.sendMessage(text, mentions.length ? { mentions } : undefined); }
  catch (e) { console.error('Send error:', e.message); }
}
async function removeMessage(message) {
  try { await message.delete(true); } catch (e) { console.error('Delete error:', e.message); }
}

async function enforceBlacklist(chat, contact) {
  const num = numberFromId(contact.id._serialized);
  if (!num || !bannedNumbers.has(num) || !chat.isGroup) return false;
  const participant = chat.participants.find(p => p.id._serialized === contact.id._serialized);
  if (participant && !participant.isAdmin) {
    try { await chat.removeParticipants([contact.id._serialized]); } catch (e) { console.error('Blacklist removal error:', e.message); }
    await send(chat, `🚫 @${contact.number || num} is on the bot blacklist and was removed.`, [contact]);
    return true;
  }
  return false;
}

client.on('message', async message => {
  try {
    const chat = await getChat(message);
    const text = String(message.body || '').trim();
    const contact = await message.getContact();

    if (chat.isGroup && await enforceBlacklist(chat, contact)) return;

    if (text === '!help') {
      await send(chat, `🤖 *WHATSAPP MODERATION BOT*\n\nGeneral:\n!help — show commands\n!ping — bot status\n\nAdmin-only group moderation:\n!delete — delete a replied message\n!warn @user — warn a member\n!kick @user — remove a member\n!ban @user — blacklist and remove a member\n!unban @user — remove a number from blacklist\n!banned — show blacklist\n\nProtection:\n🛡️ Anti-spam\n🛡️ Anti-mass-mention\n🤖 Repetition/automation detection`);
      return;
    }
    if (text === '!ping') { await send(chat, '🏓 Pong! Bot is online.'); return; }
    if (!chat.isGroup) return;

    if (text === '!delete') {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      if (!message.hasQuotedMsg) return send(chat, '⚠️ Reply to the message you want to delete.');
      const quoted = await message.getQuotedMessage();
      await removeMessage(quoted);
      await removeMessage(message);
      return;
    }

    if (text.startsWith('!warn')) {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const mentions = await message.getMentions();
      if (!mentions.length) return send(chat, '⚠️ Tag the member you want to warn.');
      const user = mentions[0];
      const id = user.id._serialized;
      const count = (warnings.get(id) || 0) + 1;
      warnings.set(id, count);
      await send(chat, `⚠️ @${user.number} has been warned. Warnings: ${count}/3`, [user]);
      if (count >= 3) await send(chat, `🚨 @${user.number} reached 3 warnings. An admin should review this member.`, [user]);
      return;
    }

    if (text.startsWith('!kick')) {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const mentions = await message.getMentions();
      if (!mentions.length) return send(chat, '⚠️ Tag the member you want to remove.');
      const user = mentions[0];
      const participant = chat.participants.find(p => p.id._serialized === user.id._serialized);
      if (!participant) return send(chat, '❌ Member not found.');
      if (participant.isAdmin) return send(chat, '❌ I will not remove a group admin.');
      await chat.removeParticipants([user.id._serialized]);
      return;
    }

    if (text.startsWith('!ban')) {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const mentions = await message.getMentions();
      if (!mentions.length) return send(chat, '⚠️ Tag the member you want to blacklist.');
      const user = mentions[0];
      const num = numberFromId(user.id._serialized);
      const participant = chat.participants.find(p => p.id._serialized === user.id._serialized);
      if (!num) return send(chat, '❌ Could not read that number.');
      if (participant && participant.isAdmin) return send(chat, '❌ I will not blacklist a group admin.');
      bannedNumbers.add(num);
      saveBans();
      if (participant) { try { await chat.removeParticipants([user.id._serialized]); } catch (e) { console.error('Ban removal error:', e.message); } }
      await send(chat, `🚫 @${user.number || num} has been blacklisted by the bot.`, [user]);
      return;
    }

    if (text.startsWith('!unban')) {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const mentions = await message.getMentions();
      let num = mentions.length ? numberFromId(mentions[0].id._serialized) : normalizeNumber(text.slice('!unban'.length));
      if (!num) return send(chat, '⚠️ Tag a user or provide a phone number with country code.');
      if (!bannedNumbers.delete(num)) return send(chat, 'ℹ️ That number is not on the blacklist.');
      saveBans();
      await send(chat, `✅ +${num} has been removed from the bot blacklist.`);
      return;
    }

    if (text === '!banned') {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const list = [...bannedNumbers];
      await send(chat, list.length ? `🚫 *Blacklisted numbers (${list.length})*\n${list.map(n => `• +${n}`).join('\n')}` : '✅ Blacklist is empty.');
      return;
    }

    if (message.mentionedIds && message.mentionedIds.length >= 5) {
      await removeMessage(message);
      await send(chat, `🚫 @${contact.number}, mass mentioning is not allowed.`, [contact]);
      return;
    }

    const senderId = message.author || message.from;
    const now = Date.now();
    const history = (spam.get(senderId) || []).filter(t => now - t < 10000);
    history.push(now);
    spam.set(senderId, history);

    if (history.length >= 7) {
      await removeMessage(message);
      await send(chat, `🚨 @${contact.number}, spam detected. Please slow down.`, [contact]);
      spam.set(senderId, []);
      return;
    }

    const participant = chat.participants.find(p => p.id._serialized === contact.id._serialized);
    if (participant && participant.isAdmin) return;

    const signal = botSignals.get(senderId) || { lastText: '', sameCount: 0, score: 0, lastTime: 0 };
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized && normalized === signal.lastText && now - signal.lastTime < 30000) signal.sameCount += 1;
    else signal.sameCount = 0;
    if (signal.sameCount >= 2) signal.score += 1;
    if (history.length >= 4) signal.score += 1;
    if (message.mentionedIds && message.mentionedIds.length >= 3) signal.score += 1;
    signal.lastText = normalized;
    signal.lastTime = now;

    if (signal.score >= 3) {
      await removeMessage(message);
      await send(chat, `🤖 @${contact.number}, suspicious repeated behavior detected.`, [contact]);
      signal.score = 0;
      signal.sameCount = 0;
    }
    botSignals.set(senderId, signal);
  } catch (error) {
    console.error('Message handler error:', error.stack || error.message);
  }
});

// QR endpoint deliberately disables caching because WhatsApp QR codes expire quickly.
function noCache(res) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
}

app.get('/', (_req, res) => {
  noCache(res);
  res.send(`<h2>WhatsApp Moderation Bot</h2><p>Status: ${botReady ? 'ONLINE' : 'WAITING FOR WHATSAPP LINK'}</p><p><a href="/qr">Open QR code</a></p><p><a href="/health">Health</a></p>`);
});

app.get('/qr', (_req, res) => {
  noCache(res);
  if (botReady) return res.send('<h2>Bot is already linked and online.</h2>');
  if (!latestQr) {
    return res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"></head><body style="font-family:sans-serif;text-align:center"><h2>Preparing WhatsApp QR...</h2><p id="status">Waiting for a fresh QR code. This page will check automatically.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
  }
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"></head><body style="font-family:sans-serif;text-align:center"><h2>Link WhatsApp</h2><p>WhatsApp → Linked devices → Link a device</p><img src="${latestQr}" width="420" style="max-width:95vw" /><p>QR refreshes automatically.</p><script>setTimeout(()=>location.reload(),18000)</script></body></html>`);
});

app.get('/health', (_req, res) => {
  noCache(res);
  res.json({ ok: true, whatsappReady: botReady, qrReady: Boolean(latestQr), blacklistSize: bannedNumbers.size });
});

app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));
client.initialize().catch(err => console.error('Client initialization failed:', err));
