-- Corrects the Managing Partner Salary (formerly displayed as "Fee") from
-- 5% to 6% of Gross Profit.
-- Run this in Supabase SQL Editor.

update partner_fee_rate_history
set rate_percent = 6, note = 'Managing Partner Salary'
where effective_from = '2024-01-01' and rate_percent = 5;
