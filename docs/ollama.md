# Ollama local

Instalado em um LXC separado no Proxmox em 22/09/2026. A Rosie continua usando
ChatGPT; nenhum modelo local foi selecionado no assistente de voz.

## Servidor

| Item           | Configuração                                                 |
| -------------- | ------------------------------------------------------------ |
| Proxmox        | `192.168.20.10`                                              |
| Contêiner      | LXC `910`, nome `ollama`, Debian 13, não privilegiado        |
| Ollama         | `0.34.2`, pacote oficial com SHA-256 verificado              |
| CPU            | 2 CPUs visíveis, limite agregado de 1,5 CPU, peso 50         |
| Memória        | Limite de 2304 MiB, sem swap para o contêiner                |
| Disco          | 16 GiB em `local-lvm`; cerca de 4,6 GiB usados na instalação |
| Endereço atual | `http://192.168.20.245:11434`                                |
| Rede           | VLAN 20, DHCP; MAC `BC:24:11:9E:BF:5A`                       |
| Modelos        | `qwen3:1.7b` e `qwen3:0.6b`                                  |

O endereço ainda não tem reserva DHCP no UniFi. Antes de adotá-lo como endereço
permanente de um assistente, reserve esse IP para o MAC acima e confirme o acesso.

O serviço usa somente modelos locais, um modelo e um pedido por vez. O contexto
padrão é 2048 tokens. Após dois minutos sem uso, o modelo é descarregado da
memória; a integração pode sobrescrever esse prazo. O serviço inicia com o LXC.

O LXC usa `nesting=1` para compatibilidade com o systemd do Debian 13. Após
reiniciar o contêiner, os serviços ficaram saudáveis, sem unidades com falha.

A porta 11434 aceita acesso do Home Assistant (`192.168.20.11`), do Proxmox
(`192.168.20.10`) e do próprio contêiner. Não foi publicado acesso pela internet.
As configurações estão em [nftables.conf](../infra/ollama/nftables.conf) e
[ollama.service](../infra/ollama/ollama.service).

## Testes de velocidade e qualidade

Os testes usaram CPU, duas threads, contexto de 2048 tokens, raciocínio desativado
e mensagens pequenas. Os tempos medem apenas o LLM, sem reconhecimento de fala,
geração de voz ou transporte até o ESP32.

| Teste                                          | Qwen3 1.7B          | Qwen3 0.6B         |
| ---------------------------------------------- | ------------------- | ------------------ |
| Primeira resposta, incluindo carregar o modelo | 19,61 s / 46 tokens | 6,06 s / 25 tokens |
| Resposta seguinte, modelo carregado            | 13,72 s / 48 tokens | 2,92 s / 25 tokens |
| Primeiro trecho da resposta seguinte           | 4,92 s              | 1,16 s             |
| Chamada de ferramenta fictícia de leitura      | 14,90 s             | 6,23 s             |

São medições pontuais: o tamanho das respostas difere e o servidor compartilha
recursos com outros serviços. O 1.7B reconheceu o nome do usuário, mas repetiu
conteúdo. O 0.6B escreveu “Boa dia” e respondeu “Meu nome é Caio” quando deveria
identificar o nome do usuário. Ambos produziram uma chamada estruturada válida
para a ferramenta fictícia; nenhum aparelho real foi acionado. Não ocorreu OOM
no contêiner durante as medições.

O usuário considerou cerca de 14 segundos inaceitável e confirmou que o miniPC
não tem GPU dedicada. Nenhum modelo foi promovido para a Rosie. Os modelos
ficaram instalados para testes e foram descarregados da memória após a validação.

## Cadastro opcional no Home Assistant

O HA alcançou `/api/version` e `/api/tags` do Ollama. O cadastro da integração
exige uma sessão autenticada de administrador: os tokens de serviço disponíveis
retornaram HTTP 401. Não foram criadas credenciais nem editados registros
internos do Home Assistant.

Para experimentar pelo painel:

1. Abra **Configurações → Dispositivos e serviços → Adicionar integração → Ollama**.
2. Informe `http://192.168.20.245:11434` como endereço do servidor.
3. Escolha um dos modelos instalados. Comece com o controle pelo LLM desativado,
   contexto em **2048**, histórico em **6 mensagens**, retenção em **120 segundos**
   e **Pensar antes de responder** desligado, nas opções da integração/agente.
4. Crie um assistente de teste com esse agente em **Configurações → Assistentes
   de voz**, preservando a Rosie atual. Os serviços de reconhecimento e geração
   de voz podem continuar sendo os existentes.

Os comandos locais podem ser preferidos no assistente. Habilitar o controle pelo
LLM exige avaliação adicional: a documentação do HA recomenda expor menos de 25
entidades para modelos locais. O contexto da casa pode exceder os 2048 tokens
usados nestes testes. A exposição das entidades existentes não foi alterada.

Trocar o agente no HA não exige regravar o ESP32. Instalar somente o Ollama não
torna o reconhecimento e a geração de voz locais.

## Administração

No host Proxmox, consulte o serviço com:

```sh
pct exec 910 -- ollama list
pct exec 910 -- ollama ps
pct exec 910 -- journalctl -u ollama -n 50 --no-pager
```

Para abrir um shell no contêiner, execute `pct enter 910`. Para descarregar um
modelo da memória sem apagá-lo, use `pct exec 910 -- ollama stop qwen3:1.7b`
ou `pct exec 910 -- ollama stop qwen3:0.6b`.

Pacote instalado:
`https://github.com/ollama/ollama/releases/download/v0.34.2/ollama-linux-amd64.tar.zst`.
SHA-256: `e155b83589986d2c581fdbf1381ea3ebdb16549883679cd5a0627f7cdc05b12b`.
Modelos armazenados em `/var/lib/ollama/models` dentro do LXC.

Referências: [instalação oficial](https://docs.ollama.com/linux),
[configuração do servidor](https://docs.ollama.com/faq) e
[integração com o HA](https://www.home-assistant.io/integrations/ollama/).
