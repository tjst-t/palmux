GO ?= $(shell which go 2>/dev/null || echo /usr/local/go/bin/go)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -X main.version=$(VERSION)

.PHONY: all build frontend build-linux build-arm test clean serve

all: build-linux

frontend:
	cd frontend && npm install --silent
	cd frontend && npx esbuild js/app.js \
	  --bundle --minify --outdir=build
	cp frontend/index.html frontend/build/
	cp frontend/css/style.css frontend/build/
	cp frontend/css/filebrowser.css frontend/build/
	cp frontend/css/gitbrowser.css frontend/build/
	cp frontend/css/split.css frontend/build/
	cp frontend/css/tab.css frontend/build/
	cp frontend/node_modules/highlight.js/styles/github-dark.css frontend/build/hljs-theme.css
	cp frontend/node_modules/@xterm/xterm/css/xterm.css frontend/build/
	cp frontend/manifest.json frontend/build/
	cp frontend/sw.js frontend/build/
	mkdir -p frontend/build/icons
	cp -r frontend/icons/* frontend/build/icons/

build: frontend
	CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o palmux .

build-linux: frontend
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o palmux-linux-amd64 .

build-arm: frontend
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o palmux-linux-arm64 .

test:
	$(GO) test ./...

PID_FILE := /tmp/palmux-dev.pid
LOG_FILE := /tmp/palmux-dev.log
PORTMAN_ENV := /tmp/palmux-portman.env

serve: build
	@if [ -f $(PID_FILE) ]; then \
	  OLD_PID=$$(cat $(PID_FILE)); \
	  if kill -0 $$OLD_PID 2>/dev/null; then \
	    echo "==> Killing previous palmux (PID: $$OLD_PID)..."; \
	    kill $$OLD_PID; \
	    for i in $$(seq 1 50); do kill -0 $$OLD_PID 2>/dev/null || break; sleep 0.1; done; \
	    kill -0 $$OLD_PID 2>/dev/null && kill -9 $$OLD_PID 2>/dev/null || true; \
	  fi; \
	  rm -f $(PID_FILE); \
	fi
	@portman env --name palmux --expose --output $(PORTMAN_ENV)
	@. $(PORTMAN_ENV) && \
	  echo "==> Starting Palmux on port $$PALMUX_PORT (log: $(LOG_FILE))" && \
	  nohup ./palmux --host 0.0.0.0 --port $$PALMUX_PORT > $(LOG_FILE) 2>&1 & \
	  echo $$! > $(PID_FILE) && \
	  echo "    PID: $$(cat $(PID_FILE))"

clean:
	rm -rf frontend/build palmux palmux-linux-amd64 palmux-linux-arm64
