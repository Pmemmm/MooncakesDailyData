#!/usr/bin/env bash
set -e

TODAY=$(date +%F)
YESTERDAY=$(date -d "yesterday" +%F)

python fetch.py

mkdir -p diff

if [ -f "data/$YESTERDAY.csv" ]; then
  node diff.js "data/$YESTERDAY.csv" "data/$TODAY.csv" "diff/$TODAY.diff.csv"
fi
