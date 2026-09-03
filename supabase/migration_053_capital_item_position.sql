-- Lets a capital transaction's detail lines be manually reordered (e.g.
-- moving an "Opening Stock" line down to a specific position) instead of
-- relying on insertion order, which Postgres doesn't reliably preserve when
-- several lines are inserted in one batch (they can share the same
-- created_at timestamp).
-- Run this in Supabase SQL Editor.

alter table capital_transaction_items add column if not exists position integer not null default 0;
