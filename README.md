# Gurbani Finder (test version)

Listens to kirtan, works out which shabad is being sung and shows the current line
(Gurmukhi with vishraams, English translation, transliteration) — no operator needed.

- Speech-to-text: Google Gemini Live (`gemini-3.5-transcribe-live`). Your key is entered on the page and stays in your browser.
- Gurbani data: [Shabad OS Database](https://github.com/shabados/database). Gurbani is public domain; translations belong to their authors.
- Matching: the transcript is reduced to a consonant "skeleton" and matched against every line, then the app locks onto a shabad and follows its lines.

Open `index.html` over https (e.g. GitHub Pages). Settings → "Test with a recording" lets you test with a kirtan audio file.
