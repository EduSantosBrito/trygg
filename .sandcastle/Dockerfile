FROM node:24-bookworm

ENV PATH="/home/agent/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ARG JJ_VERSION=0.40.0

RUN apt-get update && apt-get install -y \
  git \
  ca-certificates \
  curl \
  unzip \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) target="x86_64-unknown-linux-musl" ;; \
    arm64) target="aarch64-unknown-linux-musl" ;; \
    *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-${target}.tar.gz" \
    | tar -xz -C /usr/local/bin ./jj; \
  chmod +x /usr/local/bin/jj

RUN usermod -d /home/agent -m -l agent node
RUN mkdir -p /home/agent/.local/share /home/agent/.local/state /home/agent/.config \
  && chmod -R 0777 /home/agent

RUN npm install -g opencode-ai@latest

USER agent
WORKDIR /home/agent

RUN curl -fsSL https://bun.sh/install | bash

ENTRYPOINT ["sleep", "infinity"]
