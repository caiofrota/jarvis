#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "robot.h"
#include <cstring>

static nvs_handle_t prefs;
std::atomic<bool> portal_active{false};
std::atomic<LinkStatus> link_status{LinkStatus::wifi};
static httpd_handle_t http;
std::string portal_pin;
std::string setting(const char *key) {
  size_t len = 0;
  if (nvs_get_str(prefs, key, nullptr, &len) != ESP_OK || !len)
    return "";
  std::string value(len, '\0');
  nvs_get_str(prefs, key, value.data(), &len);
  value.resize(len - 1);
  return value;
}
static const char html[] =
    R"HTML(<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wi-Fi da Rosie</title><style>body{font:16px system-ui;background:#eef1e6;color:#25443b;max-width:440px;margin:40px auto;padding:20px}label{display:block;margin:16px 0}input,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #adc1af;border-radius:8px;font:inherit}button{background:#245a4c;color:white}p{line-height:1.5}</style><h1>Wi-Fi da Rosie</h1><p>Escolha a rede de 2,4 GHz. Informe a rede e o endereço do seu painel. Para um novo vínculo, gere um PIN em Robôs → Vincular por PIN.</p><form id="f"><label>Nome da rede<input name="ssid" maxlength="32" required autocomplete="off"></label><label>Senha do Wi-Fi<input name="password" type="password" maxlength="63" autocomplete="new-password"></label><label>Endereço do painel<input name="server" id="server" placeholder="192.168.0.226:8765" maxlength="150" required></label><label>PIN do painel (novo vínculo)<input name="pin" inputmode="numeric" maxlength="6" placeholder="Se já está vinculado, deixe vazio"></label><button>Conectar</button></form><p id="status" role="status"></p><script>fetch('/info').then(r=>r.json()).then(v=>{document.querySelector('[name=ssid]').value=v.ssid;document.getElementById('server').value=v.server;}).catch(()=>{});document.getElementById('f').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});document.getElementById('status').textContent=await r.text();}catch{document.getElementById('status').textContent='Conecte-se à rede Rosie e tente novamente.';}b.disabled=false;};</script></html>)HTML";
// The WPA2 setup network is the authority to change Wi-Fi. Requests from the
// household LAN cannot overwrite network settings or the server binding.
static bool setup_client(httpd_req_t *req) {
  sockaddr_in peer{};
  socklen_t len = sizeof(peer);
  if (getpeername(httpd_req_to_sockfd(req), (sockaddr *)&peer, &len) != 0 ||
      peer.sin_family != AF_INET)
    return false;
  esp_netif_ip_info_t ap{};
  auto *netif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
  if (!netif || esp_netif_get_ip_info(netif, &ap) != ESP_OK)
    return false;
  return (peer.sin_addr.s_addr & ap.netmask.addr) ==
         (ap.ip.addr & ap.netmask.addr);
}
// Answer A queries on the isolated setup AP, so operating systems can open the
// setup page automatically. Other query types receive an empty successful
// answer.
static void dns_task(void *) {
  int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (fd < 0) {
    vTaskDelete(nullptr);
    return;
  }
  sockaddr_in local{};
  local.sin_family = AF_INET;
  local.sin_port = htons(53);
  local.sin_addr.s_addr = inet_addr("192.168.4.1");
  if (bind(fd, (sockaddr *)&local, sizeof(local)) < 0) {
    close(fd);
    vTaskDelete(nullptr);
    return;
  }
  uint8_t packet[512];
  while (true) {
    sockaddr_in peer{};
    socklen_t plen = sizeof(peer);
    int n =
        recvfrom(fd, packet, sizeof(packet) - 16, 0, (sockaddr *)&peer, &plen);
    if (n < 17 || packet[4] != 0 || packet[5] != 1 || (packet[2] & 0x80))
      continue;
    int pos = 12;
    while (pos < n && packet[pos]) {
      if (packet[pos] > 63) {
        pos = n;
        break;
      }
      pos += 1 + packet[pos];
    }
    if (pos + 5 > n)
      continue;
    bool address = packet[pos + 1] == 0 && packet[pos + 2] == 1 &&
                   packet[pos + 3] == 0 && packet[pos + 4] == 1;
    int size = pos + 5;
    packet[2] = 0x81;
    packet[3] = 0x80;
    packet[6] = 0;
    packet[7] = address ? 1 : 0;
    packet[8] = packet[9] = packet[10] = packet[11] = 0;
    if (address) {
      const uint8_t answer[] = {0xc0, 0x0c, 0, 1, 0,   1,   0, 0,
                                0,    0,    0, 4, 192, 168, 4, 1};
      memcpy(packet + size, answer, sizeof(answer));
      size += sizeof(answer);
    }
    sendto(fd, packet, size, 0, (sockaddr *)&peer, plen);
  }
}
static std::string panel_address() {
  auto value = setting("panel_url");
  if (!value.empty())
    return value;
  value = setting("server");
  auto pos = value.find("/ws/robot/");
  if (pos != std::string::npos)
    value.resize(pos);
  if (value.starts_with("wss://"))
    value.replace(0, 6, "https://");
  else if (value.starts_with("ws://"))
    value.replace(0, 5, "http://");
  return value;
}
static std::string normalize_panel(std::string value) {
  while (!value.empty() && value.back() == '/')
    value.pop_back();
  if (!value.starts_with("http://") && !value.starts_with("https://")) {
    if (value.find(':') == std::string::npos)
      value += ":8765";
    value = "http://" + value;
  }
  auto host = value.substr(value.find("://") + 3);
  if (host.empty() || host.find_first_of("/?#@ \r\n\t") != std::string::npos)
    return "";
  return value;
}
static esp_err_t get_info(httpd_req_t *req) {
  auto *info = cJSON_CreateObject();
  cJSON_AddStringToObject(info, "ssid", setting("ssid").c_str());
  cJSON_AddStringToObject(info, "server", panel_address().c_str());
  char *text = cJSON_PrintUnformatted(info);
  httpd_resp_set_type(req, "application/json");
  auto result = httpd_resp_sendstr(req, text);
  cJSON_free(text);
  cJSON_Delete(info);
  return result;
}
bool network_ready() {
  wifi_ap_record_t ap{};
  esp_netif_ip_info_t ip{};
  auto *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  return esp_wifi_sta_get_ap_info(&ap) == ESP_OK && netif &&
         esp_netif_get_ip_info(netif, &ip) == ESP_OK && ip.ip.addr != 0;
}
bool provision_pair() {
  static bool rejected = false;
  static int64_t last_try = -10000000;
  auto pin = setting("pair_pin");
  if (pin.empty())
    return !setting("server").empty() && !setting("token").empty();
  if (!network_ready() || rejected ||
      esp_timer_get_time() - last_try < 10000000)
    return false;
  last_try = esp_timer_get_time();
  link_status = LinkStatus::pairing;
  auto base = panel_address(), url = base + "/api/pair";
  esp_http_client_config_t cfg{};
  cfg.url = url.c_str();
  cfg.timeout_ms = 4000;
  cfg.crt_bundle_attach = esp_crt_bundle_attach;
  auto client = esp_http_client_init(&cfg);
  if (!client) {
    link_status = LinkStatus::unavailable;
    return false;
  }
  auto body = std::string("{\"pin\":\"") + pin + "\"}";
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  bool ok = esp_http_client_open(client, body.size()) == ESP_OK;
  if (ok)
    ok = esp_http_client_write(client, body.data(), body.size()) ==
         (int)body.size();
  if (ok)
    ok = esp_http_client_fetch_headers(client) >= 0;
  int code = ok ? esp_http_client_get_status_code(client) : 0;
  char reply[512]{};
  int total = 0;
  if (code == 200) {
    while (total < 511) {
      int n = esp_http_client_read(client, reply + total, 511 - total);
      if (n <= 0)
        break;
      total += n;
    }
  }
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
  if (code != 200) {
    rejected = code == 401;
    link_status = rejected ? LinkStatus::bad_pin : LinkStatus::unavailable;
    return false;
  }
  auto *json = cJSON_Parse(reply);
  auto *id = cJSON_GetObjectItem(json, "id");
  auto *token = cJSON_GetObjectItem(json, "token");
  ok = cJSON_IsString(id) && cJSON_IsString(token) &&
       strlen(id->valuestring) <= 40 && strlen(token->valuestring) >= 16 &&
       strlen(token->valuestring) <= 128;
  if (ok) {
    auto ws = base;
    ws.replace(0, base.starts_with("https://") ? 5 : 4,
               base.starts_with("https://") ? "wss" : "ws");
    ws += "/ws/robot/";
    ws += id->valuestring;
    nvs_set_str(prefs, "server", ws.c_str());
    nvs_set_str(prefs, "token", token->valuestring);
    nvs_erase_key(prefs, "pair_pin");
    nvs_commit(prefs);
    link_status = LinkStatus::server;
  } else
    link_status = LinkStatus::unavailable;
  cJSON_Delete(json);
  return ok;
}
static esp_err_t get_page(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}
static esp_err_t save(httpd_req_t *req) {
  if (req->content_len <= 0 || req->content_len > 1024)
    return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Dados invalidos");
  char buffer[1025];
  int read = 0;
  while (read < req->content_len) {
    int n = httpd_req_recv(req, buffer + read, req->content_len - read);
    if (n <= 0)
      return ESP_FAIL;
    read += n;
  }
  buffer[read] = 0;
  cJSON *root = cJSON_Parse(buffer);
  if (!root)
    return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "JSON invalido");
  if (!setup_client(req)) {
    cJSON_Delete(root);
    return httpd_resp_send_err(
        req, HTTPD_403_FORBIDDEN,
        "Conecte-se à rede Wi-Fi Rosie para configurar.");
  }
  const char *keys[] = {"ssid", "password"};
  auto *ssid = cJSON_GetObjectItem(root, "ssid");
  auto *password = cJSON_GetObjectItem(root, "password");
  if (!cJSON_IsString(ssid) || !cJSON_IsString(password) ||
      strlen(ssid->valuestring) == 0 || strlen(ssid->valuestring) > 32 ||
      strlen(password->valuestring) > 63) {
    cJSON_Delete(root);
    return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                               "Confira o nome e a senha do Wi-Fi.");
  }
  auto *address = cJSON_GetObjectItem(root, "server");
  auto *pin = cJSON_GetObjectItem(root, "pin");
  if (!cJSON_IsString(address) || !cJSON_IsString(pin) ||
      strlen(address->valuestring) > 150) {
    cJSON_Delete(root);
    return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                               "Confira o endereço do painel.");
  }
  auto base = normalize_panel(address->valuestring);
  std::string code = pin->valuestring;
  bool code_valid = code.size() == 6 &&
                    code.find_first_not_of("0123456789") == std::string::npos;
  if (base.empty() || (!code.empty() && !code_valid) ||
      ((base != panel_address() || setting("token").empty()) && !code_valid)) {
    cJSON_Delete(root);
    return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                               "Informe o endereço do painel e, para novo "
                               "vínculo, o PIN de seis dígitos.");
  }
  nvs_set_str(prefs, "panel_url", base.c_str());
  if (code_valid)
    nvs_set_str(prefs, "pair_pin", code.c_str());
  for (auto key : keys)
    nvs_set_str(prefs, key, cJSON_GetObjectItem(root, key)->valuestring);
  nvs_commit(prefs);
  cJSON_Delete(root);
  httpd_resp_sendstr(req, "Salvo. A Rosie vai reiniciar e conectar ao Wi-Fi.");
  xTaskCreate(
      [](void *) {
        vTaskDelay(pdMS_TO_TICKS(700));
        esp_restart();
      },
      "restart", 2048, nullptr, 1, nullptr);
  return ESP_OK;
}
void provision_open() {
  if (portal_active.exchange(true))
    return;
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  wifi_config_t ap{};
  snprintf((char *)ap.ap.ssid, sizeof(ap.ap.ssid), "Rosie-%02X%02X%02X", mac[3],
           mac[4], mac[5]);
  strncpy((char *)ap.ap.password, portal_pin.c_str(),
          sizeof(ap.ap.password) - 1);
  ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
  ap.ap.max_connection = 2;
  ap.ap.channel = 6;
  esp_wifi_set_mode(WIFI_MODE_APSTA);
  esp_wifi_set_config(WIFI_IF_AP, &ap);
  esp_wifi_start();
  ESP_LOGI("portal",
           "Wi-Fi setup AP %s; open http://192.168.4.1 (PIN displayed on OLED)",
           ap.ap.ssid);
  auto *ap_netif = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
  esp_netif_dns_info_t dns{};
  dns.ip.type = ESP_IPADDR_TYPE_V4;
  dns.ip.u_addr.ip4.addr = inet_addr("192.168.4.1");
  esp_netif_dhcps_stop(ap_netif);
  uint8_t offer = 1;
  esp_netif_dhcps_option(ap_netif, ESP_NETIF_OP_SET,
                         ESP_NETIF_DOMAIN_NAME_SERVER, &offer, sizeof(offer));
  esp_netif_set_dns_info(ap_netif, ESP_NETIF_DNS_MAIN, &dns);
  esp_netif_dhcps_start(ap_netif);
  xTaskCreate(dns_task, "setup_dns", 3072, nullptr, 2, nullptr);
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.stack_size = 4096;
  cfg.max_open_sockets = 3;
  cfg.uri_match_fn = httpd_uri_match_wildcard;
  if (httpd_start(&http, &cfg) == ESP_OK) {
    httpd_uri_t info{};
    info.uri = "/info";
    info.method = HTTP_GET;
    info.handler = get_info;
    httpd_register_uri_handler(http, &info);
    httpd_uri_t page{};
    page.uri = "/*";
    page.method = HTTP_GET;
    page.handler = get_page;
    httpd_register_uri_handler(http, &page);
    httpd_uri_t post{};
    post.uri = "/save";
    post.method = HTTP_POST;
    post.handler = save;
    httpd_register_uri_handler(http, &post);
  }
}
static void event(void *, esp_event_base_t base, int32_t id, void *) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START &&
      !setting("ssid").empty())
    esp_wifi_connect();
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED)
    esp_wifi_connect();
}
void provision_init() {
  auto result = nvs_flash_init();
  if (result == ESP_ERR_NVS_NO_FREE_PAGES ||
      result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ESP_ERROR_CHECK(nvs_flash_init());
  }
  ESP_ERROR_CHECK(nvs_open("rosie", NVS_READWRITE, &prefs));
  portal_pin = setting("portal_pin");
  if (portal_pin.empty()) {
    char pin[9];
    snprintf(pin, sizeof(pin), "%08lu",
             (unsigned long)(esp_random() % 100000000));
    portal_pin = pin;
    nvs_set_str(prefs, "portal_pin", pin);
    nvs_commit(prefs);
  }
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  esp_netif_create_default_wifi_ap();
  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  // Real-time audio needs consistent delivery more than bulk throughput.
  // Avoid repeated block-ack renegotiation observed with this ESP32/AP pair.
  cfg.ampdu_rx_enable = 0;
  cfg.ampdu_tx_enable = 0;
  ESP_ERROR_CHECK(esp_wifi_init(&cfg));
  esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, event, nullptr);
  esp_wifi_set_storage(WIFI_STORAGE_RAM);
  wifi_config_t station{};
  auto ssid = setting("ssid"), password = setting("password");
  strncpy((char *)station.sta.ssid, ssid.c_str(), sizeof(station.sta.ssid));
  strncpy((char *)station.sta.password, password.c_str(),
          sizeof(station.sta.password));
  station.sta.threshold.authmode =
      password.empty() ? WIFI_AUTH_OPEN : WIFI_AUTH_WPA2_PSK;
  esp_wifi_set_mode(WIFI_MODE_STA);
  esp_wifi_set_config(WIFI_IF_STA, &station);
  esp_wifi_start();
  esp_wifi_set_ps(WIFI_PS_NONE);
  if (ssid.empty())
    provision_open();
  else
    xTaskCreate(
        [](void *) {
          vTaskDelay(pdMS_TO_TICKS(45000));
          wifi_ap_record_t ap;
          if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK)
            provision_open();
          vTaskDelete(nullptr);
        },
        "wifi_check", 2048, nullptr, 1, nullptr);
}
