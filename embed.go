package main

import "embed"

//go:embed frontend/build/*
var frontendFS embed.FS
