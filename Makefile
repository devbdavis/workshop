# Workshop — Docker build & run helpers.
#
#   make docker-build     Build the image (workshop:latest)
#   make docker-up        Build + start in the background (docker compose)
#   make docker-down      Stop and remove the container
#   make docker-restart   Restart the running container (no rebuild)
#   make docker-rebuild   Rebuild the image and recreate the container
#   make docker-logs      Tail the container logs
#   make docker-shell     Open a shell inside the running container
#
# Override the image tag or compose file from the CLI, e.g.
#   make docker-build IMAGE=workshop:dev
#   make docker-build NO_CACHE=1

IMAGE   ?= workshop:latest
COMPOSE ?= docker compose
SERVICE ?= workshop
REPO    ?= https://github.com/bdavis-klaviyo/workshop.git
REF     ?= main

# Pass NO_CACHE=1 to force a clean rebuild (e.g. to pull a newer Claude CLI).
BUILD_FLAGS :=
ifeq ($(NO_CACHE),1)
  BUILD_FLAGS += --no-cache
endif

.DEFAULT_GOAL := help

.PHONY: help docker-build docker-build-git docker-up docker-down docker-restart docker-rebuild docker-logs docker-shell

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

docker-build: ## Build the image from the local checkout (workshop:latest)
	DOCKER_BUILDKIT=1 docker build $(BUILD_FLAGS) -t $(IMAGE) .

docker-build-git: ## Build straight from GitHub (make docker-build-git REF=workshop/task-e9d50a)
	DOCKER_BUILDKIT=1 docker build $(BUILD_FLAGS) -t $(IMAGE) "$(REPO)\#$(REF)"

docker-up: ## Build (if needed) and start in the background
	$(COMPOSE) up -d --build

docker-down: ## Stop and remove the container
	$(COMPOSE) down

docker-restart: ## Restart the running container without rebuilding
	$(COMPOSE) restart $(SERVICE)

docker-rebuild: ## Rebuild the image from scratch and recreate the container
	$(COMPOSE) up -d --build --force-recreate

docker-logs: ## Tail the container logs
	$(COMPOSE) logs -f $(SERVICE)

docker-shell: ## Open a bash shell inside the running container
	$(COMPOSE) exec $(SERVICE) bash
