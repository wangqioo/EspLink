# Database Changes

This project currently keeps Prisma schema changes in `prisma/schema.prisma` and does not have an existing `prisma/migrations` history.

For production-like databases, apply additive schema changes with the SQL files in `db/migrations/`.

## Firmware Releases

To create the table needed by OTA release decisions, use host/user/database flags from `DATABASE_URL`:

```bash
mysql -h127.0.0.1 -P3306 -uroot -p xiaozhi < db/migrations/2026-06-15-create-firmware-releases.sql
```

## Production Keys

`REQUIRE_DEVICE_PSK=true` requires a provisioned production key row for each device before it can call `POST /api/ota/check`:

```bash
mysql -h127.0.0.1 -P3306 -uroot -p xiaozhi < db/migrations/2026-06-15-create-production-keys.sql
```

Enable the env flag only after the table exists and the target devices have `production_keys` rows. Otherwise boot registration returns `403`.

Local development can still use:

```bash
npm run db:push
npm run db:generate
```

Run `npm run db:generate` after schema changes so `@prisma/client` exposes new models.
