#!/bin/bash
# (Re)start or resume the QuvSelect v1 run in the background. Safe to call repeatedly: does nothing if it is running.
cd "$(dirname "$0")/.."
pgrep -f "python -m quvrelo_ml[.]train_v1" > /dev/null && { echo "already running"; exit 0; }
export HF_HOME=$PWD/.hf
setsid nohup .venv/bin/python -m quvrelo_ml.train_v1 "$@" >> logs/train_v1.out 2>&1 < /dev/null &
echo started
