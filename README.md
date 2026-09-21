# Employee QR Code Generator

A small, self-contained web app for generating QR codes for employees, with your
company logo centered on each code.

- Type a name (plus optional department and phone number) and generate a QR code.
- The QR code encodes a vCard, so scanning it with a phone camera offers to save the
  person as a contact (name + number), rather than showing raw text.
- Upload your logo once; it's centered on every QR code generated afterwards. The
  QR codes use the highest error-correction level so the logo doesn't break scanning.
- Every employee you generate is saved in the browser (localStorage) and listed in a
  searchable table, where you can edit or delete them later.
- Use **Export backup (.json)** / **Import backup** to move saved data between
  browsers or computers.

## Running it

This is a static site with no build step and no server-side code. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static file server, e.g. `npx serve .`

## Credits

Uses the [QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library)
by Project Nayuki (MIT License) for QR code encoding.
