# Kari Kadai

Inventory, sales, and accounting dashboard for a meat retail shop. React (Vite) frontend, Supabase (Postgres + Auth) backend.

## Modules

- Inventory (products, stock movements, stock verification, low-stock alerts)
- Sales (Restaurant / Home Delivery / Counter channels, credit tracking)
- Purchases (with CSV import from accounting app)
- Petty Cash
- Customers & Credit (outstanding balances, age-of-debt)
- Suppliers
- Monthly Fixed & Variable Expenses
- Daily Closing (cash reconciliation)
- GST (Singapore IRAS quarterly filing aid)
- Reports & Dashboard (trend charts, P&L, drill-down, PDF/Excel export)

## Local development

```
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev
```

Database schema: run `supabase/schema.sql` in your Supabase project's SQL Editor.

## Deployment

Deployed on Vercel, auto-building from the `main` branch. Environment variables required in Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
