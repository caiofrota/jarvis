ESPHOME_IMAGE := ghcr.io/esphome/esphome:2026.9.0@sha256:f6509fcf917a732fd80058567b237d5b9286b9dc6c8dde1b655fbb69ebd600ad
DOCKER_RUN = docker run --rm --cpus=1 --memory=1536m --memory-swap=2g \
	--user "$(shell id -u):$(shell id -g)" \
	-e PLATFORMIO_CORE_DIR=/config/.esphome/platformio \
	-e UV_CACHE_DIR=/config/.cache/uv \
	-e IDF_COMPONENT_CACHE_PATH=/config/.cache/idf-components \
	-e CCACHE_DIR=/config/.cache/ccache \
	-v "$(CURDIR):/config" $(ESPHOME_IMAGE)

.PHONY: test validate build build-oled
test:
	@mkdir -p .cache/tests
	$(CXX) -std=c++17 -Wall -Wextra -Werror -I. tests/conversation_session_test.cpp -o .cache/tests/conversation_session_test
	.cache/tests/conversation_session_test

validate:
	$(DOCKER_RUN) -q config desk-robot.yaml
	$(DOCKER_RUN) -q config desk-robot-oled.yaml

build:
	$(DOCKER_RUN) compile desk-robot.yaml

build-oled:
	$(DOCKER_RUN) compile desk-robot-oled.yaml
