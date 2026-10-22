# Published Fast results

The game fetches this directory at runtime. `build.mjs` copies it to `dist/fast`, and GitHub Pages serves that copy at `fast/<version>/`.

The long hex name is the current engine version. Records are immutable: do not rename the folder or edit a shard in place. Publication steps are in [`scripts/FAST.md`](../scripts/FAST.md).
