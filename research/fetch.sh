#!/bin/bash
# fetch.sh name:arxivid ... -> sources/<name>.pdf (ignored by git) and sources/<name>.txt
cd "$(dirname "$0")/sources"
for pair in "$@"; do
  n=${pair%%:*}; id=${pair#*:}
  [ -s "$n.txt" ] && continue
  curl -sL -A "breaking-bellman research (https://github.com/Hadrien-Cornier/breaking-bellman)" -o "$n.pdf" "https://arxiv.org/pdf/$id" && pdftotext -layout "$n.pdf" "$n.txt" && echo "$n $id $(wc -w < $n.txt) words"
  sleep 4
done
