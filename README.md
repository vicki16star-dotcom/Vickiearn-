# WhatsApp Moderation Bot

Commands:
- `!help`
- `!ping`
- `!delete` (admin)
- `!warn @user` (admin)
- `!kick @user` (admin)
- `!ban @user` (admin)
- `!unban @user` (admin)
- `!banned` (admin)

Protection:
- Anti-spam
- Anti-mass-mention
- Persistent bot blacklist
- Admin-only moderation commands

## Render
Deploy as Docker. The app exposes port 3000. Use a persistent disk mounted at `/app/data` so the WhatsApp session and blacklist survive restarts. Open `/qr` to link the WhatsApp account.
