#! 
# Convenience wrapper for building and running Linux Mentor as a rootless
# podman container on Fedora, with chats/ and settings.json persisted on
# the host via bind mounts.
#
# Usage:
#   ./scripts/podman-run.sh build      # build the image
#   ./scripts/podman-run.sh run        # run it (foreground)
#   ./scripts/podman-run.sh run -d     # run it detached
#   ./scripts/podman-run.sh stop       # stop + remove the container
#
set -euo pipefail

IMAGE_NAME="linux-mentor"
CONTAINER_NAME="linux-mentor"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cmd="${1:-}"
shift || true

case "$cmd" in
  build)
    podman build -t "$IMAGE_NAME" -f Containerfile "$PROJECT_DIR"
    ;;

  run)
    # --network=slirp4netns:allow_host_loopback=true lets the container reach
    # Ollama listening on the host's 127.0.0.1:11434 via host.containers.internal,
    # without resorting to --network=host (which shares the whole host network
    # namespace and is the simpler but less isolated alternative - see README).
    podman run "$@" \
      --name "$CONTAINER_NAME" \
      --network=slirp4netns:allow_host_loopback=true \
      -e OLLAMA_ENDPOINT="http://host.containers.internal:11434" \
      -p 3000:3000 \
      -v "$PROJECT_DIR/chats:/app/chats:Z" \
      -v "$PROJECT_DIR/settings.json:/app/settings.json:Z" \
      "$IMAGE_NAME"
    ;;

  stop)
    podman stop "$CONTAINER_NAME" 2>/dev/null || true
    podman rm "$CONTAINER_NAME" 2>/dev/null || true
    ;;

  *)
    echo "Usage: $0 {build|run [-d]|stop}"
    exit 1
    ;;
esac
