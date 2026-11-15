#!/bin/bash
# Ingest each archive as soon as its download completes.
cd /c/Users/Zephyrus/nasa
while true; do
  for z in data/raw/*_all_countries.zip; do
    PYTHONIOENCODING=utf-8 python pipeline/ingest.py "$z" | grep -v '^skip'
  done
  if grep -q ALL_DONE data/dl.log && ! ls data/raw/*.part >/dev/null 2>&1; then
    for z in data/raw/*_all_countries.zip; do PYTHONIOENCODING=utf-8 python pipeline/ingest.py "$z" | grep -v '^skip'; done
    echo INGEST_DONE; break
  fi
  sleep 30
done
