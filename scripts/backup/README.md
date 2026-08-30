# Local Backup / Restore

One-click backup of everything in Supabase (all table data + the `branding`
Storage files) to a folder on your own PC, and a matching restore.

## One-time setup

1. In the app, make sure the account you'll use here has the **Admin** role
   (Settings -> User Roles). The restore tool needs Admin to work.
2. In this folder, copy `.env.backup.example` to `.env.backup` and fill in
   that account's email/password. This file is gitignored -- it never gets
   committed or pushed.
3. Run the SQL in `supabase/migration_047_admin_restore_helpers.sql` once,
   in the Supabase SQL Editor (only needed for restore, not backup, but do
   it now so it's ready when you need it).

## Taking a backup

Double-click **`backup.bat`**.

It signs in, downloads every table's data as JSON and every file in the
`branding` Storage bucket, and saves it all into a new timestamped folder
under `backups/` (e.g. `backups/2026-08-30_1430/`) at the project root.
Copy that folder somewhere safe afterwards -- a USB drive, cloud storage,
wherever -- the `backups/` folder itself is gitignored and only lives on
this PC.

There's no set schedule built in; run it as often as you'd like (e.g. once
a day, or before making any risky change).

## Restoring a backup

Double-click **`restore.bat`**. By default it restores the *most recent*
backup folder. To restore an older one, drag that folder onto `restore.bat`
instead (or run `node scripts\backup\restore.js "backups\2026-08-20_0900"`
from a terminal).

**This deletes all current data in the live database and replaces it with
the backup's snapshot. It cannot be undone.** The script requires you to
type `RESTORE` in full before it does anything, as a safety check.

What it does, in order:
1. Disables every table's triggers (so re-inserting old rows doesn't fire
   the same stock-deduction / average-cost / audit-log logic a second time
   on top of data that already reflects it).
2. Clears every table.
3. Re-inserts each table's rows from the backup, in an order that respects
   foreign keys (e.g. products before sale_invoice_items).
4. Re-enables triggers.
5. Re-uploads the `branding` Storage files.

If step 4 itself fails (rare -- a network drop mid-restore, say), the
script prints a loud warning with the exact SQL to run by hand in the
Supabase SQL Editor to fix it: `select admin_set_triggers(true);`. Until
that's run, new sales/purchases through the app won't deduct stock or log
to the audit trail, so don't ignore that warning if it appears.

## What this does and doesn't cover

- Covers: every table's data, and the `branding` bucket's files.
- Does **not** cover: user logins themselves (Supabase Auth accounts,
  passwords). Restoring assumes the same logins already exist -- it only
  restores `user_roles` (who has Admin vs Sales), not the accounts
  themselves. If you ever need to move this data to a *different* Supabase
  project (not just restore into this same one), that's a separate task --
  ask for it and it can be set up when needed.
- Does **not** run on a schedule -- it's manual, run-it-yourself, by
  design (no server-side credentials are involved, so there's nothing
  running unattended with access to your database).
