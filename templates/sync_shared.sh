#!/bin/sh
# Each template stays standalone, so it carries its own copy of the shared files. Edit _shared, then run this.
cd "$(dirname "$0")" || exit 1
for t in voice-notes:saidwire.js meeting-notes:saidwire.js,captions.js video-captions:saidwire.js,audio.js,captions.js podcast-transcripts:saidwire.js,audio.js,captions.js; do
  dir=${t%%:*}; mkdir -p "$dir/lib"
  for f in $(echo "${t#*:}" | tr , ' '); do cp "_shared/$f" "$dir/lib/$f"; done
done
