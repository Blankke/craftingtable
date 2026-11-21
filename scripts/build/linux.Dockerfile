# 使用范例：npm run dist:linux:docker；在 Debian 12 构建 Linux x64 AppImage、DEB、RPM。
# 容器仅编译和打包，Electron 桌面验收在宿主机或原生 CI runner 执行。
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
FROM ${NODE_IMAGE}
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates binutils rpm xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG ELECTRON_MIRROR
ARG ELECTRON_BUILDER_BINARIES_MIRROR
ENV NODE_USE_ENV_PROXY=1
RUN --mount=type=cache,target=/root/.cache npm run test:unit && npm run test:tooling && npm run dist:linux
