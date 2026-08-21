# Bundled fonts

`DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` are bundled because PDF's base-14
fonts cover Latin only. Russian receipts need embedded Cyrillic glyphs, and the
₽ sign, so the receipt generator embeds these faces.

**DejaVu Fonts** — free licence, redistribution permitted (derived from the
Bitstream Vera Fonts, which are Bitstream-copyright with a permissive grant;
Arev-derived additions are public domain).

- Project: <https://dejavu-fonts.github.io/>
- Full licence text: <https://dejavu-fonts.github.io/License.html>

If these files are removed, `src/services/receipt-pdf.js` falls back to
Helvetica and produces the receipt in English, rather than emitting a document
full of blank glyph boxes.
