package main

import "embed"

//go:embed all:frontend/build
var frontendFS embed.FS
