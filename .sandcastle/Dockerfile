FROM node:24-bookworm

ARG JJ_VERSION=0.40.0

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Install jj for the jj-based Sandcastle workflow.
RUN arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
    amd64) jj_arch="x86_64" ;; \
    arm64) jj_arch="aarch64" ;; \
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-${jj_arch}-unknown-linux-musl.tar.gz" \
  | tar -xz -C /usr/local/bin ./jj \
  && jj --version

# Rename the base image's "node" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN usermod -d /home/agent -m -l agent node

# Runtime --user may differ from build-time UID (1000). OpenCode and git both
# need writable state/config locations inside the sandbox.
RUN mkdir -p /home/agent/.local/share /home/agent/.local/state /home/agent/.config \
  && chmod -R 0777 /home/agent \
  && touch /home/agent/.gitconfig \
  && chmod 666 /home/agent/.gitconfig

# Install OpenCode CLI and bun (run as root before USER agent)
RUN npm install -g opencode-ai@latest bun@latest

USER agent

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
