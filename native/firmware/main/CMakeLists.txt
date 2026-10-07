idf_component_register(SRCS "main.cpp" "wake.cpp" "face.cpp" "provision.cpp"
    INCLUDE_DIRS "." REQUIRES esp_wifi esp_http_server esp_http_client nvs_flash esp_timer
    esp_event esp_netif driver json esp_driver_i2s esp_driver_i2c esp_driver_ledc)
