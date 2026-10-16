#!/bin/sh
# Publish the game on GitHub Pages: build dist/breaking-bellman.html and push it as index.html to the gh-pages branch.
# The site: https://hadrien-cornier.github.io/breaking-bellman/  (repository Settings, Pages: branch gh-pages, folder /).
# Usage: sh publish-pages.sh   (from a clean main; it works in a temporary clone, so your checkout is not touched)
set -e
cd "$(dirname "$0")"
node build.mjs
url=$(git remote get-url origin)
rev=$(git rev-parse --short HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if git ls-remote --exit-code --heads "$url" gh-pages >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch gh-pages "$url" "$tmp"
else
  git init --quiet "$tmp" && git -C "$tmp" checkout --quiet -b gh-pages && git -C "$tmp" remote add origin "$url"
fi
cp dist/breaking-bellman.html "$tmp/index.html"
touch "$tmp/.nojekyll"
git -C "$tmp" add index.html .nojekyll
if git -C "$tmp" diff --cached --quiet; then echo "Pages already up to date ($rev)."; exit 0; fi
git -C "$tmp" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit --quiet -m "Publish $rev"
git -C "$tmp" push --quiet origin gh-pages
echo "Published $rev to gh-pages. GitHub Pages updates in a minute or two."
