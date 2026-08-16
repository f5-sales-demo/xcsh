# Test --source install from local repo
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y curl ca-certificates unzip build-essential git && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:/root/.local/bin:$PATH"

# Copy local repo
WORKDIR /repo
COPY . .

# Exercise the public installer against an exact commit in this isolated repository.
RUN git init -q && \
    git config user.name "xcsh installer test" && \
    git config user.email "xcsh-installer-test@example.com" && \
    git add . && \
    git add -f bun.lock && \
    git commit -qm "test: source installer fixture"
RUN XCSH_SOURCE_REPO_URL=/repo PI_INSTALL_DIR=/root/.local/bin \
    bash scripts/install.sh --source --ref "$(git rev-parse HEAD)"

# Verify
RUN xcsh --version
