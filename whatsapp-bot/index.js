const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQr = null;
let botReady = false;
const warnings = new Map();
const spam = new Map();
const botSignals = new Map();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-moderator' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', async (qr) => {
  latestQr = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
  botReady = false;
  console.log('A new WhatsApp QR code is available at /qr');
});

client.on('authenticated', () => console.log('WhatsApp authenticated.'));
client.on('ready', () => {
  botReady = true;
  latestQr = null;
  console.log('WhatsApp bot is READY.');
});
client.on('auth_failure', (msg) => console.error('Authentication failure:', msg));
client.on('disconnected', (reason) => {
  botReady = false;
  console.log('WhatsApp disconnected:', reason);
});

async function isAdmin(message) {
  const chat = await message.getChat();
  if (!chat.isGroup) return false;
  const contact = await message.getContact();
  const participant = chat.participants.find(p => p.id._serialized === contact.id._serialized);
  return Boolean(participant && participant.isAdmin);
}

async function safeReply(message, text, mentions = []) {
  try {
    await message.reply(text, undefined, mentions.length ? { mentions } : undefined);
  } catch (e) {
    console.error('Reply error:', e.message);
  }
}

client.on('message', async (message) => {
  try {
    const chat = await message.getChat();
    const text = message.body.trim();

    if (text === '!help') {
      await safeReply(message,
`🤖 *WHATSAPP BOT*

General commands:
!help — show commands
!ping — check if the bot is online

Group moderation commands (admins only):
!delete — delete a replied message
!warn @user — warn a member
!kick @user — remove a member

Group protection:
🛡️ Anti-spam
🛡️ Anti-mass-mention
🤖 Anti-bot behavior detection`);
      return;
    }

    if (text === '!ping') {
      await safeReply(message, '🏓 Pong! The WhatsApp bot is online.');
      return;
    }

    if (!chat.isGroup) return;

    const senderId = message.author || message.from;

    if (text === '!delete') {
      if (!(await isAdmin(message))) return safeReply(message, '❌ Admins only.');
      if (!message.hasQuotedMsg) return safeReply(message, '⚠️ Reply to the message you want to delete.');
      const quoted = await message.getQuotedMessage();
      await quoted.delete(true);
      return;
    }

    if (text.startsWith('!warn')) {
      if (!(await isAdmin(message))) return safeReply(message, '❌ Admins only.');
      const mentions = await message.getMentions();
      if (!mentions.length) return safeReply(message, '⚠️ Tag the member you want to warn.');
      const user = mentions[0];
      const id = user.id._serialized;
      const count = (warnings.get(id) || 0) + 1;
      warnings.set(id, count);
      await safeReply(message, `⚠️ @${user.number} has been warned. Warnings: ${count}/3`, [user]);
      if (count >= 3) {
        await safeReply(message, `🚨 @${user.number} has reached 3 warnings. An admin should review this member.`, [user]);
      }
      return;
    }

    if (text.startsWith('!kick')) {
      if (!(await isAdmin(message))) return safeReply(message, '❌ Admins only.');
      const mentions = await message.getMentions();
      if (!mentions.length) return safeReply(message, '⚠️ Tag the member you want to remove.');
      const user = mentions[0];
      const participant = chat.participants.find(p => p.id._serialized === user.id._serialized);
      if (!participant) return safeReply(message, '❌ Member not found.');
      if (participant.isAdmin) return safeReply(message, '❌ I will not remove a group admin.');
      await chat.removeParticipants([user.id._serialized]);
      return;
    }

    // Anti-mass-mention.
    if (message.mentionedIds && message.mentionedIds.length >= 5) {
      await message.delete(true);
      const sender = await message.getContact();
      await safeReply(message, `🚫 @${sender.number}, mass mentioning is not allowed.`, [sender]);
      return;
    }

    const now = Date.now();
    const history = spam.get(senderId) || [];
    const recent = history.filter(t => now - t < 10000);
    recent.push(now);
    spam.set(senderId, recent);

    // Anti-spam: 7 messages in 10 seconds triggers deletion of the latest message.
    if (recent.length >= 7) {
      await message.delete(true);
      const sender = await message.getContact();
      await safeReply(message, `🚨 @${sender.number}, spam detected. Please slow down.`, [sender]);
      spam.set(senderId, []);
      return;
    }

    // Behavioral anti-bot: do not claim certainty; score repeated automation-like behavior.
    // A score of 3 triggers a warning/deletion. Admins are never auto-moderated.
    const contact = await message.getContact();
    const participant = chat.participants.find(p => p.id._serialized === contact.id._serialized);
    if (participant && participant.isAdmin) return;

    const signal = botSignals.get(senderId) || { lastText: '', sameCount: 0, score: 0, lastTime: 0 };
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized && normalized === signal.lastText && now - signal.lastTime < 30000) {
      signal.sameCount += 1;
    } else {
      signal.sameCount = 0;
    }
    if (signal.sameCount >= 2) signal.score += 1;
    if (recent.length >= 4) signal.score += 1;
    if (message.mentionedIds && message.mentionedIds.length >= 3) signal.score += 1;

    signal.lastText = normalized;
    signal.lastTime = now;

    if (signal.score >= 3) {
      await message.delete(true);
      await safeReply(message, `🤖 @${contact.number}, suspicious automated behavior detected. Please stop repeated messages.`, [contact]);
      signal.score = 0;
      signal.sameCount = 0;
    }
    botSignals.set(senderId, signal);
  } catch (error) {
    console.error('Message handler error:', error.message);
  }
});

app.get('/', (_req, res) => {
  res.send(`<h2>WhatsApp Bot</h2><p>Status: ${botReady ? 'ONLINE' : 'WAITING FOR WHATSAPP LINK'}</p><p><a href="/qr">Open QR code</a></p>`);
});

app.get('/qr', (_req, res) => {
  if (botReady) return res.send('<h2>Bot is already linked and online.</h2>');
  if (!latestQr) return res.status(503).send('<h2>QR code is not ready yet. Refresh in a few seconds.</h2>');
  res.send(`<html><body style="font-family:sans-serif;text-align:center"><h2>Link WhatsApp</h2><p>WhatsApp → Linked devices → Link a device</p><img src="${latestQr}" width="420" /></body></html>`);
});

app.get('/health', (_req, res) => res.json({ ok: true, whatsappReady: botReady }));

app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));
client.initialize();
