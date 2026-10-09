import type { EntityMap } from "@rosie/types";

/** Export contains identifiers and topics only, never server or broker credentials. */
export function homeAssistantPackage(endpoint: EntityMap["endpoints"], prefix: string) {
  const suffix = endpoint.id.replaceAll("-", "_"),
    base = `rosie_${suffix}`,
    topic = `${prefix}/${endpoint.homeId}/${endpoint.id}`,
    sensor = `sensor.${base}_resposta`;
  return `# Install as a Home Assistant package. Requires MQTT connected to Rosie's broker.
# Verify the sensor entity ID after installation; an existing ID collision may add a suffix.
# These scripts speak or return a choice. They never control a device by themselves.
mqtt:
  sensor:
    - name: ${JSON.stringify(`Rosie ${endpoint.name} resposta`)}
      unique_id: ${JSON.stringify(`${base}_interaction_result`)}
      default_entity_id: ${sensor}
      state_topic: ${JSON.stringify(`${topic}/result`)}
      qos: 1
      value_template: >-
        {{ {'id': value_json.id, 'status': value_json.status, 'choice': value_json.choice | default('')} | to_json }}

script:
  ${base}_avisar:
    alias: ${JSON.stringify(`Rosie · Avisar em ${endpoint.name}`)}
    mode: queued
    max: 3
    fields:
      mensagem:
        name: Mensagem
        required: true
        selector:
          text:
            multiline: true
    sequence:
      - action: mqtt.publish
        data:
          topic: ${JSON.stringify(`${topic}/request`)}
          qos: 1
          retain: false
          payload: >-
            {{ {'id': now().strftime('%Y%m%d%H%M%S%f') ~ '-' ~ (range(1000000) | random), 'type': 'announce', 'text': mensagem, 'expiresAt': (now() + timedelta(seconds=120)).isoformat()} | to_json }}

  ${base}_perguntar:
    alias: ${JSON.stringify(`Rosie · Perguntar em ${endpoint.name}`)}
    mode: single
    fields:
      mensagem:
        name: Pergunta
        required: true
        selector:
          text:
            multiline: true
    sequence:
      - variables:
          request_id: "{{ now().strftime('%Y%m%d%H%M%S%f') ~ '-' ~ (range(1000000) | random) }}"
      - action: mqtt.publish
        data:
          topic: ${JSON.stringify(`${topic}/request`)}
          qos: 1
          retain: false
          payload: >-
            {{ {'id': request_id, 'type': 'ask', 'text': mensagem, 'expiresAt': (now() + timedelta(seconds=120)).isoformat(), 'timeoutSeconds': 30, 'busyPolicy': 'reject'} | to_json }}
      # The sensor is subscribed before publication and stores even an immediate result.
      # A late or unrelated ID cannot authorize this question. Timeout is never approval.
      - wait_template: >-
          {% set result = states('${sensor}') | from_json({}) %}
          {{ result.get('id') == request_id and result.get('status') != 'duplicate' }}
        timeout: "00:02:10"
        continue_on_timeout: true
      - variables:
          resposta: >-
            {% set result = states('${sensor}') | from_json({}) %}
            {{ result if wait.completed and result.get('id') == request_id else {'id': request_id, 'status': 'timeout', 'choice': ''} }}
      - stop: Pergunta concluída
        response_variable: resposta
`;
}
