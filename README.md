# Employee QR Code Generator

A small, self-contained web app for generating QR codes for employees, with your
company logo centered on each code.

- Type a name (plus optional department and phone number) and generate a QR code.
- The QR code encodes a vCard, so scanning it with a phone camera offers to save the
  person as a contact (name + number), rather than showing raw text.
- Upload a logo once; it's centered on every QR code and shared with everyone who
  opens the app. QR codes use the highest error-correction level so the logo
  doesn't break scanning.
- Every employee is saved in a shared Supabase database (not per-browser storage),
  and listed in a searchable table where anyone with the link can edit or delete
  them later.
- Use **Export backup (.json)** / **Import backup** for manual backups or bulk
  transfers.

## Architecture

Static frontend (`index.html` / `app.js` / `style.css`) talks directly to two
Supabase Edge Functions (`employees`, `settings`) over HTTPS using the public
anon key. Those functions run server-side with the Supabase service-role key and
are the only way to read or write the `employees` / `app_settings` tables — Row
Level Security is enabled with no policies, so the anon key alone has zero direct
table access. There is no login system, so anyone with the deployed link can add,
edit, or delete entries.

## Running it

This is a static site with no build step. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static file server, e.g. `npx serve .`

Either way it talks to the live Supabase project — there's no local backend to run.

## Credits

Uses the [QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library)
by Project Nayuki (MIT License) for QR code encoding.
