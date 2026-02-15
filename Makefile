GO ?= $(shell which go 2>/dev/null || echo /usr/local/go/bin/go)

.PHONY: build frontend build-linux build-arm test clean

frontend:
	cd frontend && npx esbuild js/app.js \
	  --bundle --minify --outdir=build
	cp frontend/index.html frontend/build/
	cp frontend/css/style.css frontend/build/
	cp frontend/node_modules/@xterm/xterm/css/xterm.css frontend/build/
	cp frontend/manifest.json frontend/build/
	cp frontend/sw.js frontend/build/
	mkdir -p frontend/build/icons
	cp -r frontend/icons/* frontend/build/icons/

build: frontend
	CGO_ENABLED=0 $(GO) build -o palmux .

build-linux: frontend
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 $(GO) build -o palmux-linux-amd64 .

build-arm: frontend
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 $(GO) build -o palmux-linux-arm64 .

test:
	$(GO) test ./...

clean:
	rm -rf frontend/build palmux palmux-linux-amd64 palmux-linux-arm64
