# Local packaging repair for @vercel/og 1.0.3

This private package retains the complete official Satori 0.33.5 SVG security fix. The upstream 1.0.3 package embeds HarfBuzz's CommonJS loader but omits hb.wasm. Its Node ESM loader throws a dynamic-require error; edge runtimes also need precompiled WebAssembly modules.

The only runtime changes supply the unmodified harfbuzzjs 0.10.0 hb.wasm through Emscripten's supported instantiateWasm hook, load it as a static module on Workers and from the package file on Node, and avoid HarfBuzz's unnecessary CommonJS filesystem branch when that hook is supplied. No SVG serializers or security checks are replaced. UPSTREAM.json records provenance and source hashes.

The original MPL-2.0 license and bundled contributor notices apply. HarfBuzz's MIT license is included separately. This package is private and must not be published under Vercel's name. Remove this packaging repair once an official compatible distribution renders normally on both Node and Workers.

The original runtime code is recoverable by reversing the four listed modifications; its SHA-256 is checked against the official package. Unmodified upstream source maps are intentionally omitted because they do not describe the packaging repair.
