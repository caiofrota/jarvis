# Conversa e personalidade

A experiência desejada combina escuta entre respostas, contexto da sessão e um
agente com personalidade. O ESP32 cuida do áudio e da tela; o Home Assistant
encaminha a fala, mantém a integração com a casa e chama o agente de conversa.

## Configuração inspecionada em 2026-09-21

A Rosie está selecionada com `conversation.chatgpt`, STT/TTS do Home Assistant
Cloud em `pt-BR`, voz LeilaNeural e openWakeWord `okay_nabu`. A preferência por
tratar comandos localmente está ligada. O agente ChatGPT tem acesso à API Assist
e ainda usa o prompt padrão, curto e orientado a respostas objetivas.

Em **Configurações → Dispositivos e serviços → OpenAI**, abra as opções da entrada
de conversa **ChatGPT**. O campo **Instruções** aceita o conteúdo de
[personality-prompt.txt](personality-prompt.txt). Esse arquivo é uma proposta pronta
para colar; não é carregado automaticamente nem foi aplicado ao agente remoto.
A alteração do prompt fica no servidor e não exige regravar o ESP32.

Mantenha a opção de tratar comandos localmente primeiro para preservar as respostas
das intents personalizadas. Uma resposta local bem-sucedida é entregue diretamente;
ela não ganha automaticamente o estilo do prompt do ChatGPT. Personalize essas
respostas no próprio `intent_script`. Conversas que chegam ao ChatGPT usam seu
prompt e o contexto da sessão. Desligar a prioridade local muda esse encaminhamento
e pode fazer uma pergunta deixar de acionar a frase personalizada.

## Frases de temperatura existentes

O idioma efetivo usado para intents da Rosie é `pt-BR`, derivado do STT. O HA
2026.8.3 carrega o diretório `custom_sentences/pt-BR`. A pasta encontrada como
`pt-br` não corresponde a esse caminho em um sistema que diferencia maiúsculas.

As frases ficam em `/config/custom_sentences/pt-BR/temperature.yaml`, com a regra
compartilhada em `_common.yaml`; as respostas ficam em `/config/configuration.yaml`,
na seção `intent_script`. Use **Ferramentas do desenvolvedor → Ações →
conversation.reload** para recarregar as frases após uma edição. Se editar também
as respostas, recarregue `intent_script` pelo recurso de recarga disponível no HA.

- “Qual a temperatura lá fora?” → `CustomOutsideTemperature`.
- “Quantos graus está fazendo lá fora?” → `CustomOutsideTemperature`.
- “Qual a umidade lá fora?” → `CustomOutsideHumidity`.
- “Qual o clima lá fora?” não está entre as frases cadastradas.

As duas intents externas atualmente escolhem textos prontos sobre calor; não
consultam uma medição externa. A resposta de umidade repete as mesmas brincadeiras
da temperatura. Para dados reais, é necessário vincular uma entidade de clima ou
sensor e usar o valor atual na resposta.

## Ativação e limites

A nova conversa contínua exige instalar o firmware atualizado. Com a função
ligada, chame “Okay Nabu” uma vez, faça a pergunta e continue depois da resposta.
A janela inicial é de 30 segundos. “Encerrar conversa” ou o silêncio devolvem
o robô à espera da palavra de ativação. Leia os detalhes no [README](../README.md).

“Acorda Cosmo” como nome no prompt não altera o detector de ativação. Essa frase
precisa de um modelo de wake word compatível no servidor. O modelo atual continua
sendo Okay Nabu.

O [projeto Cozmo](https://github.com/fabriciowth/cozmo-esp32) usa o navegador do
celular ou computador para ouvir e reproduzir voz. A implementação aqui pretende
manter microfone e alto-falante no próprio ESP32. Em ambos, a fala do usuário
durante a reprodução não é uma interrupção de voz garantida. Nosso firmware
atual pausa a escuta durante a resposta; áudio com interrupções naturais e
cancelamento de eco exigiria uma etapa adicional de desenvolvimento.

O prompt pode tornar o texto mais expressivo; a entonação também depende da voz
TTS. Expressões por estado já existem na variante OLED. Reagir ao humor de uma
resposta requer ainda um caminho explícito de comandos de expressão entre o
agente e o ESP32; isso não vem apenas da troca do prompt.

Referências: [instruções do agente OpenAI no HA](https://www.home-assistant.io/integrations/openai_conversation/),
[prompt engineering da OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering),
[carregamento das intents no HA 2026.8.3](https://github.com/home-assistant/core/blob/2026.8.3/homeassistant/components/conversation/default_agent.py).
