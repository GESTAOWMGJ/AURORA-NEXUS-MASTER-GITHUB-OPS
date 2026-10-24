Historical public source fixture for the synthetic signed-ancestry regression.

`published-update-1eb89666.cjs.txt` is the exact Git blob from source
`1eb89666b7c9d468958c7c6f226b69c901588be2`, path `desktop/ia-master/published-update.cjs`.
SHA-256: `8a06ac140bdc33b254ab5ad8ee52dc298f1fed28256c49fd49e895d3b288da84`.
The test VM substitutes only its existing synthetic bootstrap/layout seams and
intercepts HTTPS, native managers and loopback; no installed package is read or changed.
The fixture is never included in an IA/Windows package or imported by production.
It keeps the regression reproducible in a shallow checkout without fetching history.
