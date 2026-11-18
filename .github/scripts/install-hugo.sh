#!/bin/bash
# Installs the Hugo version in .hugo-version, after checking the download against
# Hugo's published checksums. Used by the GitHub Actions workflows.
set -euo pipefail
v=$(cat .hugo-version)
file="hugo_${v}_linux-amd64.tar.gz"
base="https://github.com/gohugoio/hugo/releases/download/v${v}"
cd "$(mktemp -d)"
curl -fsSLO "$base/$file"
curl -fsSLO "$base/hugo_${v}_checksums.txt"
grep " ${file}\$" "hugo_${v}_checksums.txt" | sha256sum -c -
tar -xzf "$file" hugo
sudo mv hugo /usr/local/bin/hugo
hugo version
