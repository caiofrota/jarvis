> Current application control and administration now live in `../apps/web`.
> The active speech worker is `voice/app.py`; `server/app.py` and its static panel
> are retained for rollback. Follow [the current installation guide](../docs/engineering/installation.md).
> Hardware, wake-word and speech-model instructions below still apply unless marked legacy.

# Rosie nativa

Robô de mesa com firmware ESP-IDF no ESP32-WROOM e servidor Python separado do
Home Assistant. Esta versão mantém a detecção de **Okay Nabu na placa**, usa
Whisper e vozes Piper, Kokoro ou Supertonic no servidor local e permite escolher OpenAI ou DeepSeek no painel.

O painel desta instalação está em **http://192.168.0.226:8765**. A senha inicial
fica em `data/admin.token`, acessível somente ao usuário do serviço. Não publique
esse arquivo, a pasta `data/` ou imagens de gravação com credenciais.

## Primeiro teste

1. Abra o painel e entre com a senha gerada. Em **Robôs**, confira Rosie no
   **Escritório**. O cômodo pode ser alterado e salvo sem regravar a placa.
2. Aguarde o robô aparecer conectado. Diga **Okay Nabu**, espere os olhos de
   escuta e diga **bom dia**. Essa intenção funciona sem chamada ao LLM.
3. Em **Robôs → Testar voz**, é possível conferir a saída sem depender do microfone.
   Depois da resposta, continue falando sem repetir a palavra de ativação.
   Após a espera configurada sem uma nova fala, começa a fase sonolenta, que
   também escuta. Ao terminar essa fase ela dorme. Para encerrar antes, diga
   **pode dormir**, **pare**, **cancela**, **chega** ou **tchau**. O tempo é ajustável no painel.
4. Experimente **que horas são** e depois uma pergunta aberta. A pergunta aberta
   usa o provedor e a chave de API configurados em **Voz e conexões**.
5. Confira erros, duração do STT e tokens informados pelo provedor em **Atividade**.
   Tokens são contagens, não estimativas de cobrança. Confira valores no provedor.

Esta primeira versão é half-duplex: não interpreta interrupções enquanto fala.
A boca acompanha a intensidade dos blocos em reprodução; não é lipsync por
fonema. Ao encerrar a conversa por inatividade, ela fica com olhos de tédio e
boca reta, bocejando por 2,5 segundos a cada 25 segundos. **Ela ainda escuta nessa
fase: basta falar para continuar, sem repetir Okay Nabu.** Em **Voz e conexões →
Escuta sonolenta antes de dormir**, ajuste a duração dessa fase: padrão 60 segundos,
de 0 a 3600; zero pula a sonolência. Essa duração é independente da espera por
uma nova fala. Depois, fecha os olhos sem piscar e mostra “zzz”; encerra a escuta
da conversa e mantém apenas a palavra de ativação para acordar. “Pode dormir”
encerra diretamente, sem esperar o temporizador. Os comandos de encerramento
funcionam durante a escuta; interromper a reprodução ainda não é suportado.
Pensando, a carinha inteira se move suavemente para os lados, com os olhos na
altura normal, sem olhar para cima e sem balão.
A boca tem preenchimento, tanto ao falar quanto ao bocejar.
Os olhos abertos piscam em intervalos aleatórios de 2,5–6 segundos.
Textos sobre o rosto ficam reservados a conexão, pareamento e erros.

O estado de pensamento inclui reconhecimento, resposta e geração da voz.
Antes dele, uma segunda verificação local de fala (Silero VAD, incluído no
faster-whisper) filtra os candidatos do detector WebRTC. Ruído rejeitado não
chama o STT nem o LLM, não gera resposta e não renova o tempo de escuta.
Se houver fala mas o STT não entender, ela pede para repetir uma vez; após
duas tentativas consecutivas sem transcrição, dorme diretamente. Uma fala
entendida ou nova ativação zera essa contagem. Vozes de TV e vídeos ainda
podem passar: este filtro detecta fala, não identifica quem está falando.
As durações de STT, TTS e preparação da resposta aparecem em **Atividade**.
Falas curtas repetidas podem reutilizar áudio em memória, com limite de 32
itens e 4 MiB; uma resposta inédita ainda precisa ser sintetizada localmente.

Nas respostas, os olhos acompanham o tom: neutro, feliz, triste, irritado,
surpreso, curioso, confuso, empolgado, tímido, desconfiado, orgulhoso ou carinhoso.
A cara curiosa mostra interesse com os dois olhos abertos; a confusa mantém
a assimetria de dúvida. A expressão vale para a resposta inteira e é escolhida
na mesma chamada da IA. Em **Robôs → Testar expressão**, você pode conferir
cada desenho por 3 segundos, sem gerar fala nem gastar tokens.

Em **Voz e conexões → Reserva de áudio antes de tocar**, ajuste de 60 a 1800 ms.
A instalação usa 600 ms; a placa guarda até cerca de 2,5 segundos de áudio comprimido.
Essa reserva suaviza variações da conexão e não acelera a geração da voz.
Cada resposta toca como um áudio único, sem esperar outra síntese entre frases.
O servidor prepara os modelos locais ao iniciar, sem emitir som. Frases inéditas
na Dora ainda exigem processamento; repetir uma frase em cache é mais rápido.

As novas caras também têm demonstrações locais: diga **faz cara de confusa**,
**faz cara de empolgada**, **faz cara de tímida**, **faz cara de desconfiada**,
**faz cara de orgulhosa** ou **faz cara de carinhosa**. Elas aparecem em
**Robôs → Testar expressão** e podem ser editadas em **Intents**.

A personagem entra em brincadeiras sobre seu humor. As demonstrações abaixo
têm quatro respostas bem-humoradas cada, sorteadas localmente sem chamar a IA.
Em **Intents**, edite as frases, respostas e expressões:

| Intenção      | Exemplo de frase                      |
| ------------- | ------------------------------------- |
| Cara feliz    | “Você fica feliz?” ou “Dá um sorriso” |
| Cara triste   | “Faz cara de triste”                  |
| Cara brava    | “Você fica com raiva?”                |
| Cara surpresa | “Faz cara de surpresa”                |
| Cara curiosa  | “Você é curiosa?”                     |
| Cara neutra   | “Faz cara de paisagem”                |

Essas brincadeiras são pedidos de demonstração da personagem; dizer “estou triste”
não aciona uma piada cadastrada. A personalidade também orienta variações de conversa
a manter a personagem sem avisos genéricos sobre emoções, preservando respostas
normais nos demais assuntos e explicações honestas quando você pedir detalhes técnicos.

Em **Voz e conexões → Voz local**, selecione uma voz e use **Ouvir no navegador**
para comparar a mesma frase antes de salvar. A amostra toca no computador ou
celular e não depende da conexão do robô. Use **Salvar alterações** para aplicar
a voz escolhida; não precisa regravar o ESP32. Faber, Cadu, Dora e Supertonic F1/M1 estão instaladas neste
servidor. Para adicionar Cadu em outra instalação:

```sh
.venv/bin/python -m piper.download_voices --data-dir models/piper pt_BR-cadu-medium
```

Para instalar a Dora (Kokoro):

```sh
.venv/bin/python tools/download_kokoro.py
```

No i3 desta instalação, a Dora levou cerca de 5 segundos para gerar a frase de
teste, com o modelo já carregado. Ela pode acrescentar espera em comparação ao
Piper. Compare a voz antes de selecioná-la para conversar.

Para instalar Supertonic F1 (feminina) e M1 (masculina):

```sh
.venv/bin/python tools/download_supertonic.py
```

Supertonic usa português e duas threads de CPU. Em **Modo da voz Supertonic**,
**Rápido** usa quatro passos de geração e **Priorizar qualidade** usa oito.
O segundo modo aumenta a espera e deve ser comparado antes de salvar; mais
processamento não garante melhor entonação. Essa opção aparece ao selecionar F1 ou M1.
A amostra inclui uma pergunta para comparar a entonação. A pronúncia, o sotaque
e a prosódia devem ser avaliados no navegador; a expressão dos olhos não controla
as emoções da voz. Não há garantia de entonação interrogativa em toda frase.
O upstream foi arquivado; consulte [as licenças e fontes](THIRD_PARTY.md).

Recarregue o painel depois de instalar uma voz. As amostras usam somente síntese
local, sem tokens do LLM.

## Ligações do WROOM

Faça as ligações com a alimentação desligada. Todos os módulos compartilham GND.

| Módulo                    | Pino do módulo | ESP32                                            |
| ------------------------- | -------------- | ------------------------------------------------ |
| INMP441                   | VDD            | 3V3                                              |
| INMP441                   | GND            | GND                                              |
| INMP441                   | SCK            | GPIO25                                           |
| INMP441                   | WS             | GPIO26                                           |
| INMP441                   | SD             | GPIO33                                           |
| INMP441                   | L/R            | GND, canal esquerdo                              |
| MAX98357A                 | VIN            | 5V/VIN alimentado pelo USB                       |
| MAX98357A                 | GND            | GND                                              |
| MAX98357A                 | BCLK           | GPIO27                                           |
| MAX98357A                 | LRC            | GPIO14                                           |
| MAX98357A                 | DIN            | GPIO32                                           |
| MAX98357A                 | SD e GAIN      | configuração atual da placa, inicialmente soltos |
| OLED SSD1306 128×64, 0x3C | VCC            | 3V3                                              |
| OLED                      | GND            | GND                                              |
| OLED                      | SDA            | GPIO21                                           |
| OLED                      | SCL            | GPIO22                                           |
| LED indicador comum       | Ânodo (+)      | GPIO18, passando por resistor de 330 Ω           |
| LED indicador comum       | Cátodo (−)     | GND                                              |

O alto-falante vai **entre as duas saídas do amplificador**, nunca entre uma
saída e GND. Compartilhe 3V3 por uma derivação apropriada; EN não é alimentação.
O perfil é específico do ESP32 clássico, não do ESP8266 nem de um ESP32-S3.

### Luz de escuta e tela

O LED é opcional. Para começar, use um LED vermelho comum de baixa corrente com
**um resistor de 330 Ω em série**. Não ligue LEDs de potência diretamente ao GPIO.
Um LED pode iluminar duas bochechas por difusão; se usar dois LEDs físicos, cada um
precisa do seu próprio resistor e o circuito deve respeitar a corrente do GPIO.
O GPIO19 fica livre nesta versão.

No painel Node/React, abra **Caixinhas → Editar → Luz de escuta e fala**. Ative o LED
e escolha o brilho fixo de escuta e os limites da variação durante a fala. A luz
também fica fixa enquanto sonolenta ainda escuta; apaga nos demais estados. A variação
acompanha o áudio reproduzido, não depende de uma nova chamada ao modelo.

Em **Tela**, escolha **Apagada**, **Sempre ligada** ou **Automático**. Para automatizar,
ative **Apagar por horário** e informe, por exemplo, 22:00 e 07:00. O horário usa o
fuso da casa, todos os dias, e só vale em Automático. A voz e o LED continuam funcionando
com a tela apagada. O portal de Wi-Fi pode acendê-la temporariamente para exibir a senha.
Sem conexão com o servidor, a tela mantém a última decisão recebida.

Esses recursos exigem a revisão de firmware com LED/OLED configuráveis. Depois da
primeira gravação, os ajustes no painel não exigem novas gravações.

## Wi-Fi sem regravar

Segure **BOOT por 3 segundos**, depois solte. Sem rede inicial, ou após falhar
a conexão inicial por 45 segundos, o portal também é aberto.

1. Conecte o celular/computador à rede `Rosie-XXXXXX`, usando a senha de oito
   dígitos mostrada no OLED. Essa senha protege a rede de configuração.
2. A página pode abrir automaticamente; se não abrir, acesse **http://192.168.4.1**.
3. Informe a rede de 2,4 GHz e a senha do seu Wi-Fi. O endereço do painel aparece
   preenchido quando já existe vínculo. Para esta instalação, use
   **http://192.168.0.226:8765**, ou simplesmente `192.168.0.226:8765`.
4. Para um novo vínculo, abra **Robôs → Vincular por PIN** no painel e digite no
   portal o PIN de **seis dígitos**. Ele vale por cinco minutos e uma única vez.
   Ao trocar somente o Wi-Fi de um robô já vinculado, deixe esse PIN vazio.
5. Salve. A placa reinicia, conecta à rede e troca o PIN pelo token internamente.
   Não é necessário copiar token, caminho WebSocket ou ID técnico.

O OLED mostra `CONECTANDO WIFI`, `CONECTANDO SERVIDOR`, `VINCULANDO`, `PIN INVALIDO`
ou `SEM SERVIDOR`, além de `OUVINDO`, `PENSANDO` e `FALANDO`. A senha de oito
algarismos só aparece quando o portal está aberto; ela não é um código de erro.

O formulário aceita alterações pela rede de configuração protegida, não pela
interface da LAN doméstica. As configurações ficam na NVS. O painel e o transporte
`ws://` desta instalação são para a LAN; use VPN ou TLS antes de acessá-los por
redes externas. Não abra portas para a internet.

## Intents, humor e sensores

Em **Intents e humor**, cadastre frases equivalentes, uma por linha, e respostas
alternativas, também uma por linha. O servidor sorteia uma resposta. A comparação
ignora maiúsculas, acentos e pontuação, mas não interpreta frases arbitrárias
como equivalentes. As intenções cadastradas são processadas antes do LLM.

As respostas normais são o padrão; humor fica para contextos apropriados.
Cada intenção permite escolher a **Expressão durante a resposta**. Exemplo de
frases: `Bom dia` e `Bom dia Rosie`. Respostas possíveis, com expressão feliz:

- Bom dia!
- Bom dia! Espero que seu dia seja bom.

Você ainda pode cadastrar piadas em intenções específicas, por exemplo “conte
uma piada”, sem colocar humor em todas as saudações e agradecimentos.

Uma intenção pode ser global ou específica de um cômodo. A específica prevalece
nesse cômodo. Para temperatura, cadastre primeiro um dispositivo do tipo **sensor**
com o tópico de estado MQTT real e, se necessário, o caminho no JSON, como
`temperature`. Depois selecione esse sensor na intenção:

```text
Frase: Qual a temperatura lá fora?
Resposta: Lá fora está fazendo {valor} graus. Meus circuitos agradecem a sombra!
```

Variáveis permitidas: `{valor}`, `{nome}` e `{ambiente}`. Sem dado disponível,
o robô informa que não conseguiu obter o valor. Estados recebidos há mais de
cinco minutos são tratados como indisponíveis; uma mensagem MQTT retida não
prova a idade da medição original. Não foram inventados tópicos de sensores.

## Dispositivos e rotinas por ambiente

Cadastre o nome, apelidos, cômodo, tipo, tópico e mensagens aceitas pelo dispositivo.
Exemplo ilustrativo, que deve ser substituído pelo tópico real da sua instalação:

```json
{ "on": "ON", "off": "OFF" }
```

Um dispositivo Zigbee2MQTT pode exigir mensagens JSON, por exemplo
`{"on":"{\"state\":\"ON\"}","off":"{\"state\":\"OFF\"}"}`.
O firmware não precisa conhecer esses detalhes: o servidor publica no broker.

**Liga a luz** procura no cômodo da Rosie. **Liga a luz da cozinha** procura
na cozinha cadastrada. Um alvo ambíguo pede um nome mais específico. Não há
fallback silencioso para dispositivos de outro cômodo. Cada rotina contém ações
de dispositivos do seu próprio cômodo; para outro ambiente, indique-o na conversa.

O LLM escolhe alvos cadastrados, nunca tópicos MQTT livres. Publicações usam QoS 1
e `retain=false`; a confirmação do broker indica envio, não execução física.
Prefira comandos idempotentes como ligar/desligar. Uma rotina pode parar no meio
se a comunicação falhar; ela não é uma transação entre aparelhos.

## Instalar e desenvolver

Requisitos: Linux, Python 3.11–3.13, uv 0.8.22, Node para verificar o JavaScript,
g++ para os testes de compatibilidade do áudio e Docker para compilar o firmware.
A imagem ESP-IDF e as dependências têm versões
fixadas pelo Makefile e pelos lockfiles.

```sh
cd native
make install
PYTHONPATH=. .venv/bin/python tools/bootstrap.py
make models
make start
```

O bootstrap só cria um catálogo quando ele não existe. Cadastre o seu ambiente
no painel. Para serviço permanente no caminho desta instalação:

```sh
mkdir -p ~/.config/systemd/user
cp infra/rosie-native.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now rosie-native.service
```

Confira `loginctl show-user "$USER" -p Linger` se precisar manter um serviço de
usuário após logout. O arquivo de serviço pressupõe este checkout em
`~/workspace/desk-robot/native`; ajuste o caminho em outra instalação.

```sh
make test
make lint
make model
make build
```

A primeira compilação baixa o SDK e compila TensorFlow Lite Micro. Gravação
genérica com o ESP-IDF 5.4.2 instalado: `idf.py -C firmware -p PORTA flash monitor`.
Escolha a porta pelo identificador USB e confira o MAC antes de gravar. Este
perfil usa uma partição factory e **não implementa OTA**. Faça backup antes de
substituir outro firmware. A atualização de aplicação não exige apagar a NVS.

Para mudar a palavra embarcada ou treinar uma nova, veja [wake-word.md](docs/wake-word.md).
Detalhes do transporte e dos limites estão em [architecture.md](docs/architecture.md).
Os testes realizados nesta instalação ficam em [validation.md](docs/validation.md).
