# Pre-Push Release Check

## Directly fixed small issue
- `index.html`: baseline renderer pixel ratio was still `Math.min(devicePixelRatio, 2)` while XR/non-XR restore logic used the newer capped values. Aligned baseline to `Math.min(window.devicePixelRatio || 1, 1.5)` for consistency.

## Notes
- Some path-checker hits came from documentation comments/examples, not live imports.
