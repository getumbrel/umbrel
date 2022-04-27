#!/usr/bin/env sh

# Update configs
/filebrowser config init
/filebrowser config set --branding.name "Agora Admin"
/filebrowser users add umbrel ${APP_PASSWORD}

exec /filebrowser -p 8080 --baseurl "/admin/files"
