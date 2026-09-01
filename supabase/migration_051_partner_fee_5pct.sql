-- Corrects the Managing Partner Fee default from 10% to 5%.
-- Run this in Supabase SQL Editor.

update partner_fee_rate_history
set rate_percent = 5, note = 'Managing Partner Fee'
where effective_from = '2024-01-01' and rate_percent = 10;
