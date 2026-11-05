#!/bin/bash
# Runs inside Omarchy guests. Hyprland only shares its clipboard with an X
# client that has focus, and spice-vdagent is a windowless X client, so mirror
# the clipboard both ways to reach the agent and through it the Umbrel console.
# Each side only takes text the other doesn't have yet, so the two mirrors can't
# feed each other.
x11() { timeout 5 xclip -out -selection clipboard -target UTF8_STRING 2>/dev/null; }
wayland() { timeout 5 wl-paste --no-newline --type text 2>/dev/null; }

if [ "$1" = to-x11 ]; then
	text=$(cat)
	[ "$text" = "$(x11)" ] || printf %s "$text" | xclip -selection clipboard -target UTF8_STRING
	exit
fi

wl-paste --type text --watch "$0" to-x11 &
trap 'kill $!' EXIT
while clipnotify -s clipboard; do
	text=$(x11)
	[ -z "$text" ] || [ "$text" = "$(wayland)" ] || printf %s "$text" | wl-copy --type text/plain
done
