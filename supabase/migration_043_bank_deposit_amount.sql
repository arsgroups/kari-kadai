-- Daily Closing gains a Bank Deposit Amount, keyed in alongside Actual Cash
-- Counted, so its variance against what was actually banked can be shown.
-- Run this in Supabase SQL Editor.

alter table daily_closing add column if not exists bank_deposit_amount numeric;
