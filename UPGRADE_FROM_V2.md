# Upgrading from v2 to v3 (rupees + adaptive dashboard)

1. Stop the backend (`Ctrl+C`). Replace your project folder with this one and copy your old `backend/.env` into `backend/.env`.
   (Optional new lines are in `.env.example`: `PAYPAL_FX_RATE=88` and `TIMEZONE=Asia/Kolkata`. Without them the defaults are used.)
2. In the backend folder:
   ```powershell
   npm install
   npm run db:migrate    # applies 003 only; nothing is deleted
   ```
3. **About your existing data.** Migration 003 makes rupees the default for new shops, and switches existing shops that
   have **no products and no sales yet** to rupees. A shop that already holds data keeps its currency, because its numbers were
   entered in dollars and relabelling them as rupees would be wrong. That includes the demo bakery you seeded earlier,
   so it still shows `$` until you reload it with rupee prices:
   ```powershell
   npm run db:reset      # WARNING: erases ALL local data (including accounts you registered), then re-creates the tables and the rupee demo data
   ```
   After a reset, register your account again (or use `demo@bizpilot.ai` / `Demo@1234`).
4. `npm run dev` in `backend`, and `npm run dev` in `frontend`.
