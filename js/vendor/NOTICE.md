# Vendored libraries

Committed rather than fetched from a CDN so the app keeps working with no
network, and so an upstream change can never alter what your printer receives.

| File | Library | Licence |
| --- | --- | --- |
| `pdf-lib.min.js` | pdf-lib 1.17.1 | MIT — © Andrew Dillon |
| `fontkit.umd.min.js` | @pdf-lib/fontkit 1.1.1 | MIT — © Devon Govett |

pdf-lib writes the PDF. fontkit reads the TrueType files so pdf-lib can subset
and embed them.
