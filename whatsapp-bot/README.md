# WhatsApp Group Moderator

A small group-moderation bot using `whatsapp-web.js`.

## Commands

- `!help`
- `!delete` (reply to a message)
- `!warn @user`
- `!kick @user`

## Automatic protection

- Anti-spam: 7+ messages from one sender within 10 seconds.
- Anti-mass-mention: deletes messages mentioning 5+ people.

## Linking

After deployment, open `/qr` and scan the QR code from WhatsApp → Linked devices → Link a device.

Important: this uses an unofficial WhatsApp Web automation library. WhatsApp's own policies may restrict unofficial clients, and the library documentation warns that accounts can be blocked. Use a dedicated bot account rather than your main personal number.
