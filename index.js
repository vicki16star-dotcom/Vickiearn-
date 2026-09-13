const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const AUTH_DIR = process.env.WHATSAPP_AUTH_PATH || path.join(DATA_DIR, '.wwebjs_auth');
const BAN_FILE = path.join(DATA_DIR, 'banned.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
app.use(express.urlencoded({ extended: false }));

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
let botReady = false;
let pairingCode = null;
let pairingNumber = null;
let pairingBusy = false;
let pairingStartedAt = 0;
let pairingTimer = null;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-moderator', dataPath: AUTH_DIR }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

function clearPairingState() {
  pairingCode = null;
  pairingNumber = null;
  pairingBusy = false;
  pairingStartedAt = 0;
  if (pairingTimer) {
    clearTimeout(pairingTimer);
    pairingTimer = null;
  }
}

function armPairingTimeout() {
  if (pairingTimer) clearTimeout(pairingTimer);
  pairingTimer = setTimeout(() => {
    if (pairingBusy) {
      console.log('Pairing request timed out; clearing pairing lock.');
      clearPairingState();
    }
  }, 45000);
}

client.on('authenticated', () => {
  clearPairingState();
  console.log('WhatsApp authenticated via phone-number pairing.');
});

client.on('ready', () => {
  botReady = true;
  clearPairingState();
  console.log('WhatsApp bot is READY. Phone-number pairing mode only.');
});

client.on('auth_failure', msg => console.error('Authentication failure:', msg));
client.on('disconnected', reason => {
  botReady = false;
  clearPairingState();
  console.log('WhatsApp disconnected:', reason);
});

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
    try { await chat.removeParticipants([contact.id._serialized]); }
    catch (e) { console.error('Blacklist removal error:', e.message); }
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
      if (participant) {
        try { await chat.removeParticipants([user.id._serialized]); }
        catch (e) { console.error('Ban removal error:', e.message); }
      }
      await send(chat, `🚫 @${user.number || num} has been blacklisted by the bot.`, [user]);
      return;
    }

    if (text.startsWith('!unban')) {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const mentions = await message.getMentions();
      const num = mentions.length
        ? numberFromId(mentions[0].id._serialized)
        : normalizeNumber(text.slice('!unban'.length));
      if (!num) return send(chat, '⚠️ Tag a user or provide a phone number with country code.');
      if (!bannedNumbers.delete(num)) return send(chat, 'ℹ️ That number is not on the blacklist.');
      saveBans();
      await send(chat, `✅ +${num} has been removed from the bot blacklist.`);
      return;
    }

    if (text === '!banned') {
      if (!(await isAdmin(message))) return send(chat, '❌ Admins only.');
      const list = [...bannedNumbers];
      await send(chat, list.length
        ? `🚫 *Blacklisted numbers (${list.length})*\n${list.map(n => `• +${n}`).join('\n')}`
        : '✅ Blacklist is empty.');
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
  res.send(`<h2>WhatsApp Moderation Bot</h2><p>Status: ${botReady ? 'ONLINE' : 'WAITING FOR WHATSAPP LINK'}</p><p><a href="/pair">Link with phone number</a></p><p><a href="/health">Health</a></p>`);
});

app.get('/pair', (_req, res) => {
  noCache(res);
  if (botReady) return res.send('<h2>Bot is already linked and online.</h2>');
  if (pairingBusy) {
    const age = pairingStartedAt ? Math.round((Date.now() - pairingStartedAt) / 1000) : 0;
    return res.send(`<h2>Pairing request already in progress.</h2><p>The current request has been running for ${age}s.</p><p>Please wait up to 45 seconds, then refresh this page.</p><meta http-equiv="refresh" content="5">`);
  }
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"><title>Link WhatsApp</title></head><body style="font-family:sans-serif;text-align:center;padding:25px"><h2>Link WhatsApp by phone number</h2><p>Enter your WhatsApp number with country code, digits only.</p><p>Example: <b>2348012345678</b></p><form method="POST" action="/pair"><input name="phone" inputmode="numeric" autocomplete="tel" placeholder="2348012345678" required style="padding:12px;font-size:18px;max-width:280px"><br><button type="submit" style="margin-top:15px;padding:12px 22px;font-size:17px">Get pairing code</button></form><p style="margin-top:25px">QR connection is disabled. Use phone-number pairing only.</p></body></html>`);
});

app.post('/pair', async (req, res) => {
  noCache(res);
  if (botReady) return res.send('<h2>Bot is already linked and online.</h2>');

  // Recover automatically if an old request got stuck.
  if (pairingBusy && pairingStartedAt && Date.now() - pairingStartedAt > 45000) {
    console.log('Recovering stale pairing lock.');
    clearPairingState();
  }
  if (pairingBusy) return res.send('<h2>Pairing request already in progress.</h2><p>Wait for the current request to finish.</p>');

  const phone = normalizeNumber(req.body.phone);
  if (!/^\d{10,15}$/.test(phone)) {
    return res.status(400).send('<h2>Invalid phone number</h2><p>Use digits only, including your country code. Example: 2348012345678</p><p><a href="/pair">Try again</a></p>');
  }

  pairingBusy = true;
  pairingStartedAt = Date.now();
  pairingNumber = phone;
  pairingCode = null;
  armPairingTimeout();

  try {
    if (typeof client.requestPairingCode !== 'function') {
      clearPairingState();
      return res.status(501).send('<h2>Phone-number pairing is unavailable</h2><p>The installed WhatsApp Web library does not expose the pairing-code API.</p><p><a href="/pair">Try again</a></p>');
    }

    const codePromise = client.requestPairingCode(phone);
    pairingCode = await Promise.race([
      codePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pairing code request timed out after 45 seconds.')), 45000))
    ]);
    pairingBusy = false;
    if (pairingTimer) { clearTimeout(pairingTimer); pairingTimer = null; }

    return res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"><meta http-equiv="refresh" content="8"></head><body style="font-family:sans-serif;text-align:center;padding:25px"><h2>Your WhatsApp pairing code</h2><div style="font-size:32px;font-weight:bold;letter-spacing:5px;margin:25px 0">${pairingCode}</div><p>On your phone:</p><p><b>WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead</b></p><p>Enter the code shown above.</p><p>Keep this page open until the bot says it is linked.</p><p><a href="/pair">Request another code</a></p></body></html>`);
  } catch (error) {
    clearPairingState();
    console.error('Pairing code error:', error.stack || error.message);
    return res.status(500).send(`<h2>Could not create pairing code</h2><p>${String(error.message || error).replace(/[<>&]/g, '')}</p><p><a href="/pair">Try again</a></p>`);
  }
});

app.get('/health', (_req, res) => {
  noCache(res);
  res.json({ ok: true, whatsappReady: botReady, pairingCodeReady: Boolean(pairingCode), pairingNumber: pairingNumber ? `+${pairingNumber}` : null, pairingBusy, pairingAgeSeconds: pairingStartedAt ? Math.round((Date.now() - pairingStartedAt) / 1000) : 0, qrEnabled: false, blacklistSize: bannedNumbers.size });
});

app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));
console.log('Phone-number pairing mode only — QR connection disabled.');
client.initialize().catch(err => console.error('Client initialization failed:', err));