# Menu Decoder 🇮🇹

Offline Italian menu explainer. Snap a trattoria menu and each dish gets: what it is, its course
(antipasto / primo / secondo / contorno / dolce), the typical price compared with the menu price,
and a **locals order this** / **tourist dish** flag. Pick your region to see "★ Local specialty here".

**Zero data on roaming.** OCR runs on the phone (Tesseract WASM, Italian model). Answers come
from a curated glossary (`glossary.js`), with no AI calls, so nothing gets made up and nothing goes over the network.

## How it works
1. Photo → grayscale + contrast stretch → Tesseract (`ita`) on-device.
2. Each line is fuzzy-matched (Levenshtein, OCR-tolerant) against ~200 dishes and their aliases.
   The most specific match wins (e.g. "Pici cacio e pepe" → Cacio e pepe, plus a note on Pici).
3. Lines not in the glossary are decoded word by word from ~390 menu terms
   ("Filetto di maiale al pepe verde" → fillet · pork · green peppercorn sauce). Section headers
   (Primi, Secondi…) set the course.
4. Prices are pulled from the line and compared with the typical range. S.Q. / etto / kg are flagged as priced by weight.

For handwriting Tesseract can't read: use iPhone Live Text or Google Lens to copy the text,
then tap **Paste**. You can also edit the OCR text directly.

## Install on your phone (do this on Wi-Fi before the trip)
It needs to be served over **https** once so the service worker can cache everything (~14 MB).
Easiest options:
- **Netlify Drop**: drag this folder onto https://app.netlify.com/drop and you get a URL.
- **GitHub Pages**: push this folder to a repo, then Settings → Pages → deploy from branch.

Then on the phone: open the URL, wait for the **✓ Works offline** pill,
iPhone: Share → *Add to Home Screen*; Android: ⋮ → *Install app*. Put the phone in airplane mode and test once.

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000

## Extending
Add dishes to `DISHES` in `glossary.js`: `n` name, `c` course, `p` [low, high] €, `r` regions,
`l` locals-order flag, `trap`, `t` tags, `d` description, `tip`, `a` aliases.
After changing files, bump `CACHE` in `sw.js` so installed copies update.
