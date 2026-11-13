#!/usr/bin/env bash
set -euo pipefail
branch=${GITHUB_REF#refs/heads/}
printf 'enabled=false\nchannel=\nversion=\n' >> "$GITHUB_OUTPUT"
[[ $branch == feature/* ]] || exit 0
slug=${branch#feature/}
if [[ ! $slug =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]]; then
  echo "::error::invalid feature branch name $branch"
  exit 1
fi
channel=feature-$slug
case "$CHANNEL_KIND" in
  host) path=channels ;;
  plugin) path=data ;;
  *) echo '::error::invalid channel kind'; exit 1 ;;
esac
index=$(curl -fsSL --retry 3 "$CHANNELS_URL")
active=$(jq -e --arg path "$path" --arg channel "$channel" --arg branch "$branch" \
  '.[$path] | arrays | any(.[]; .channel == $channel and .branch == $branch and .status == "active")' <<< "$index") || {
  status=$?
  if [[ $status != 1 ]]; then exit "$status"; fi
}
if [[ $active != true ]]; then
  echo "::notice::$branch is not a promoted release channel"
  exit 0
fi
version=
if [[ $COMPUTE_VERSION == true ]]; then
  tag=$(git tag --merged HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)
  if [[ -z $tag ]]; then
    echo '::error::no stable vX.Y.Z tag reachable from HEAD'
    exit 1
  fi
  IFS=. read -r major minor patch <<< "${tag#v}"
  version="$major.$minor.$((10#$patch + 1))-$channel.${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}"
fi
printf 'enabled=true\nchannel=%s\nversion=%s\n' "$channel" "$version" >> "$GITHUB_OUTPUT"
