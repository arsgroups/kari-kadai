-- V2 Enhancement: track when a customer's custom price was last updated.
-- Run this in Supabase SQL Editor.

alter table customer_item_prices add column if not exists updated_at timestamptz not null default now();
