# Standalone consumer

This example imports only a generated bundle:

```powershell
node bin/web-extract.mjs bundle --output dist/bundle
node examples/standalone-consumer/run.mjs --bundle dist/bundle --html-file fixtures/static-list.html
```

`run.mjs` does not import from the central repository source path. A consuming application can copy the bundle and remain operational offline.
