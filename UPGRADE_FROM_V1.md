# Upgrading from the first version

Your existing database and data are kept. The new version only **adds** things (migration `002`):
a `phone` column on `users`, a `password_reset_tokens` table, and an `onboarded` flag on `businesses`.

1. Stop the backend (`Ctrl+C`).
2. Replace your project folder with this one, then copy your old `backend/.env` into `backend/.env`
   (it works unchanged; the new optional `SMTP_*` lines are in `.env.example`).
3. In the backend folder run:
   ```powershell
   npm install        # adds nodemailer
   npm run db:migrate # applies 002 only; your data stays
   npm run dev
   ```
4. In the frontend folder: `npm install` (only if node_modules is missing) then `npm run dev`.

The demo account (`demo@bizpilot.ai` / `Demo@1234`) keeps working. It has no contact number, which is fine.
Anything you registered with the old sign-up form also still works.

## "Request failed (500)" or "Cannot reach the server" on the login page
The API is not running or cannot reach PostgreSQL. In the backend terminal run `npm run dev` and read the first
error line (typically a wrong `DATABASE_URL` password, or `npm run db:migrate` was not run).
