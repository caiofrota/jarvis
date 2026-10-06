# Jarvis Studio

Assistente com IA local ou na nuvem, conversa por voz e painéis de tarefas,
notas e controle do computador. Versão atual: 0.4.0.

## Projeto

A pasta que contém este arquivo e o código-fonte do Jarvis Studio.

## Executar no Windows

1. Feche a versão antiga do Jarvis. Se existir um terminal do servidor antigo,
   pressione Ctrl+C nele. Não é preciso executar como administrador.
2. Pelo Explorador de Arquivos, abra a pasta do projeto acima.
3. Dê dois cliques em Iniciar Jarvis.cmd.
4. Deixe essa janela aberta e acesse http://127.0.0.1:4318 no Chrome.
   O iniciador não abre navegador automaticamente.
5. Para encerrar, pressione Ctrl+C na janela que você abriu.

O processo iniciado pelo seu Explorador usa a sua sessão normal do Windows.
Ele não fica dentro do ambiente protegido das ferramentas do Codex.
Se a porta 4318 estiver ocupada, o iniciador avisa e não cria uma segunda instância.
A interface Next e a ponte de controle do PC usam a mesma porta.
Alterações da interface aparecem automaticamente. Mudanças nos serviços TypeScript
reiniciam o servidor de desenvolvimento; uma conversa ativa pode ser interrompida.

## Pré-requisitos de desenvolvimento

Node.js 22.13 ou superior e pnpm 11.25.0. O CI usa Node.js 22.23.2.
Em outra máquina: instale Node.js e pnpm, copie o código-fonte e execute:
pnpm install
pnpm dev
Para a IA local, abra o Ollama e escolha um modelo em Configurações > Inteligência.
A IA na nuvem continua opcional. No aplicativo desktop, a chave OpenAI é protegida
com o armazenamento seguro do sistema e volta ao abrir o Jarvis. Na prévia do
Chrome, ela fica no localStorage deste perfil apenas para testes e não é criptografada;
remova a chave em Inteligência antes de compartilhar esse perfil do navegador.

## Aplicativo desktop sem reinstalar

Depois de mudanças na interface, execute pnpm build na pasta do projeto.
Feche o Jarvis desktop e abra Iniciar Jarvis Desktop.cmd pelo Explorador.
Ele usa o Electron da pasta de desenvolvimento e a interface exportada.
Não abra o iniciador web e o desktop ao mesmo tempo se quiser uma só instância.

## Instalador

release\v0.4.0\Jarvis Studio Setup 0.4.0.exe
O arquivo só existe após gerar o instalador. Para gerar um instalador atualizado, execute
pnpm dist --win nsis --x64 --publish never.
Não é necessário reinstalar a cada
alteração enquanto você usa o iniciador de desenvolvimento.
O aplicativo instalado inclui Electron e a interface Next exportada; não precisa
instalar Node.js nem executar um servidor Next para abrir.
O instalador ainda não tem assinatura digital nem atualização automática.

## Janelas e cards

O fundo quadriculado ocupa toda a tela, com o anel centralizado e os cards
flutuando nas laterais. Novos espaços secundários começam somente com cards;
destacar o Assistente abre uma janela com o anel. Em telas estreitas,
Mostrar cards alterna entre o anel e os cards, sem interromper a conversa.
Cada painel tem uma engrenagem discreta com suas opções. Ampliar, mover, ocultar e
abrir em nova janela ficam nesse controle, não em Configurações.
Mostrar painéis, no topo da janela, permite recuperar cards ocultos.
Ordem, visibilidade e distribuição de espaço são salvas separadamente por janela.
Nova janela cria um espaço somente de cards, sem anel; a engrenagem de um card abre uma janela
iniciada com esse card, onde você pode acrescentar outros.
Tarefas e notas continuam compartilhadas entre janelas da mesma origem.
No navegador, o endereço identifica a janela: recarregar preserva sua configuração;
salve esse endereço nos favoritos se quiser reabrir o mesmo espaço mais tarde.
Uma nova janela começa com seu próprio layout. No desktop, fechar a janela principal
fecha todas as janelas. Ao iniciar novamente, o conjunto que estava aberto volta com
os mesmos identificadores, layouts, tamanhos, posições, maximização e tela cheia.
Janelas fechadas individualmente antes disso não são reabertas. Se um monitor tiver
sido desconectado, as janelas retornam para uma área visível.
O modo Foco e a aba do Assistente também são preservados por janela; o microfone
não é ligado automaticamente ao reabrir. Ocultar o assistente encerra a escuta
naquela janela.
Os cards dividem a altura disponível e rolam seu conteúdo por dentro. Quando
não há espaço para todos, as setas de páginas dão acesso aos demais cards.
A opção Ampliar painel dá mais espaço à linha do card, mantendo tudo dentro da tela.
O teste com três janelas do navegador confirmou layouts independentes, recarga,
tarefas/notas compartilhadas e configuração de cards nas janelas destacadas.

## Voz

Chrome online: transcrição ao vivo pelo serviço do navegador, grátis e sem chave.
O áudio pode ser enviado ao provedor do navegador. É uma escolha explícita.
Clique na esfera do painel Assistente para iniciar a conversa, sem abrir outra
janela. A aba Conversa exibe a esfera; a aba Transcrição reúne o histórico,
as parciais do reconhecimento e o campo para escrever. Trocar de aba preserva
a conversa por voz e os rascunhos. Configurações > Voz reúne
reconhecimento, saída e alto-falantes/fones.
Uma pausa envia sua fala; o Jarvis responde em voz e retoma a escuta.
Durante a resposta, clique na esfera para interromper. Enquanto está ouvindo,
clique nela para encerrar; o botão Encerrar também permanece disponível.
O anel de energia tem linhas azuis ondulantes e pontos de luz em rotação, sobre
um fundo quadriculado. O brilho e a deformação acompanham a amplitude e as
frequências do áudio Kokoro/OpenAI. O centro mostra o estado real da conversa.
A voz do sistema usa movimento ambiente (não fornece áudio para análise).
O visual não usa uma biblioteca 3D: perfis limitam o desenho a 20/30/45 quadros por
segundo; ele pausa fora da tela e respeita a preferência de movimento reduzido.
Durante a fala, os filamentos ficam mais brilhantes e intensos e giram mais rápido,
sem aumentar o limite de quadros nem ativar movimento quando ele está desabilitado.
Alto-falantes (padrão): pausa o reconhecimento antes de reproduzir a resposta e
volta a ouvir 900 ms após o fim do áudio. Aguarde "Estou ouvindo" para falar.
Durante a resposta, use Interromper resposta para parar a fala do Jarvis.
Fones: mantém a escuta durante a resposta e permite interrupção por voz quando
chega uma transcrição diferente da fala do Jarvis. Volume sozinho não interrompe
a reprodução. O modo de alto-falantes prioriza evitar eco; não é uma conversa
com fala e escuta simultâneas enquanto o Jarvis está falando.
A conversa continua ouvindo ao alternar entre aplicativos. Clique em Encerrar
conversa para desligar a escuta.
Ditar mensagem continua disponível para revisar texto antes de enviar.
Local/offline: Whisper base em português, com parciais durante a gravação.
O vocabulário de reconhecimento recebe as tarefas atuais, os pedidos recentes e
os nomes disponíveis no catálogo da máquina, em um único contexto limitado,
sem substituir palavras na transcrição. Isso fornece contexto ao decoder, mas não
garante a precisão de nomes próprios; a validação acústica depende do microfone real.
Se o decodificador sinalizar baixa probabilidade, silêncio provável ou repetição
excessiva, a fala não é enviada à execução e o Jarvis pede uma repetição.
Esses sinais não são uma porcentagem de confiança e não detectam todo erro de
transcrição. O modelo recebe a indicação de que o pedido foi falado e deve pedir
esclarecimento diante de ambiguidade, sem presumir erro de digitação.
No Windows, o catálogo também consulta `Get-StartApps`, incluindo aplicativos da
Microsoft Store. Instalações com o mesmo nome exigem escolher qual abrir.
O catálogo é carregado ao iniciar o Jarvis; reinicie após instalar outro aplicativo.
Saída gratuita: Kokoro neural local ou vozes locais instaladas no sistema.
OpenAI de voz continua opcional, identificada como API paga. Não há troca
silenciosa para a nuvem quando uma opção local falha.

### ElevenLabs

Em **Configurações → Voz**, selecione ElevenLabs para reconhecimento e/ou voz de
resposta. Conecte sua chave ElevenLabs, clique em **Atualizar vozes** e escolha
uma voz da sua conta. A chave precisa de permissão para Speech to Text, Text to
Speech e leitura de vozes; é independente da chave e do modelo de inteligência.
O Jarvis não cria nem clona vozes.

O reconhecimento usa `scribe_v2`, enviando cada fala ao terminar (ou ao parar o
ditado), sem reenviar parciais. Esta integração usa transcrição por arquivo, não
`scribe_v2_realtime` por WebSocket. A resposta usa `eleven_flash_v2_5` em português,
no fluxo de síntese por blocos já existente. Não há garantia de precisão ou
latência sem teste real com sua conta, microfone e conexão.

Áudio e texto são enviados à ElevenLabs e podem ser retidos pelo provedor. O uso
da API pode gerar cobrança conforme seu plano. Recursos extras como edição de
transcrição, vocabulário pago e identificação de falantes não são habilitados.
Confira a [API de transcrição](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
e a [API de voz](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
Não ocorre troca automática para outro provedor em caso de falha.

No desktop, a chave é persistida usando o armazenamento protegido do sistema.
No navegador, permanece somente na memória do servidor local: reiniciar o
servidor exige conectar novamente. O identificador da voz e a escolha dos
provedores são salvos no perfil, mas a chave ElevenLabs não vai para localStorage.

A primeira instalação de voz local baixa pacotes e modelos. Precisa de internet
nessa instalação e de Python 3.11 com uv. O ambiente usa as dependências bloqueadas
em `voice/uv.lock`, com PyTorch CPU. No instalador, os componentes ficam em
%APPDATA%\jarvis-studio\.voice-env e os modelos em voice-models, fora da pasta
do programa. Se Python não estiver disponível, a tela explica o requisito e
mostra Tentar instalar novamente após a falha. Python não é incluído no instalador.
Reconhecimento do Chrome não está disponível dentro do Electron; use Chrome
para essa opção ou selecione o reconhecimento local no aplicativo desktop.

Ao abrir o Jarvis, o modelo Ollama já selecionado começa a aquecer em segundo plano;
seu primeiro pedido não precisa iniciar esse carregamento. Os perfis Equilibrado e
Completo mantêm a IA carregada por 10 e 30 minutos; Econômico libera ao concluir.
Pedidos escritos ou falados são interpretados pela IA, incluindo abreviações.
O nome identificado é resolvido contra os aplicativos encontrados no computador.
Destinos ausentes ou ambíguos geram uma pergunta; não há aplicativo substituto.
Botões do painel Meu computador abrem diretamente o destino escolhido.
A síntese agrupa frases, prepara até três blocos e busca uma reserva inicial de
1,4 segundo de áudio. Respostas mais curtas começam assim que estiverem prontas.
Kokoro e a saída de áudio da nuvem usam reprodução agendada, com 120 ms de silêncio
no início e 220 ms no fim da resposta, preservando todas as amostras de voz.
A captura local conserva 240 ms anteriores à detecção da fala e espera 850 ms de
silêncio para concluir o trecho. Os motores de reconhecimento e síntese são
separados. Interromper o áudio não descarrega imediatamente a voz local.
Esses ajustes reduzem fragmentação e interrupções falsas; a velocidade de geração
do texto ainda depende da IA escolhida e do computador.
Ainda não foi medida a experiência de conversa com o seu microfone nesta versão.

## Linux

Código e configuração de empacotamento mantidos para Linux.
Instale Node.js, pnpm, Python 3.11, uv e Ollama para IA local. Execute pnpm install e sh 'Iniciar Jarvis.sh'.
Para gerar AppImage/deb no Linux: pnpm dist --linux AppImage deb --x64 --publish never.
O fluxo .github/workflows/ci.yml valida o projeto em PRs e na branch principal.
O fluxo [Build desktop](.github/workflows/build-desktop.yml) gera os instaladores
Windows/Linux ao enviar uma tag `v*` iniciada por um número (por exemplo, `v0.4.1`).
Ele valida a revisão da tag antes de empacotar e guarda os binários como artefatos
por 14 dias. Testes com microfone
e interface desktop nativa precisam de validação nos sistemas de destino.

## Organização do código

```text
app/                  Rotas Next e estilos separados por área.
components/workspace/ Estrutura da janela, composição dos painéis e diálogos.
features/chat/        Histórico, envio, resposta em fluxo e interface da conversa.
features/voice/       Reconhecimento, captura, fila de frases e reprodução.
features/ai/          Provedor, modelos e conexão da chave.
features/actions/     Catálogo e abertura de aplicativos/pastas.
features/tasks, notes, calendar, system, settings/  Painéis independentes.
client/               Comunicação HTTP/IPC e armazenamento do navegador.
shared/               Tratamento de texto compartilhado com o backend.
lib/                  IA, controle do PC, permissões e motores de voz.
desktop/              Electron, janelas, permissões de microfone e IPC.
voice/                Processos Python de reconhecimento/síntese e download.
scripts/              Desenvolvimento e proteção da exportação estática.
tests/                Testes de serviços, permissões, voz e streaming.
```

Next + React, servidor, Electron e serviços estão em TypeScript estrito (.ts/.tsx).
Os contratos de mensagens, ações, voz e IPC ficam em shared/types.ts e shared/ipc.ts.
O código compilado dos serviços fica em dist/. O módulo de captura do navegador
é gerado de features/voice/pcm-worklet.ts para public/pcm-worklet.js.
Python continua responsável por Whisper/Kokoro; testes de serviços usam Node.
Para verificar tipos: pnpm typecheck. Para testar: pnpm test.
Para preparar web exportada e desktop: pnpm build.
Não há Claude Code nesta versão. Ollama e OpenAI continuam como provedores.
Trello e calendário conectado ainda são próximos passos; a agenda é demonstrativa.
Notas, tarefas e históricos existentes no mesmo navegador/origem são preservados.

### Correção de tarefas na conversa

Se a fala foi transcrita incorretamente, diga o que você quis dizer, por exemplo:
“Eu falei que eu esqueci de ir ao supermercado.” O Jarvis pode corrigir a tarefa
existente pelo seu identificador, sem criar uma segunda tarefa. A confirmação
aparece somente após salvar. Se houver dúvida sobre qual tarefa corrigir, ele
deve perguntar; tarefas excluídas, alteradas em outra janela ou títulos em conflito
não são sobrescritos. Isso não muda o reconhecimento de áudio: a interpretação
da correção ainda depende do modelo de IA selecionado.
Consultas de existência releem a lista atual, inclusive após exclusão manual;
o histórico não comprova que uma tarefa ainda existe. Ao relatar “Eu já fui ao
supermercado”, o Jarvis pode marcar a tarefa correspondente como concluída e
confirma somente depois de salvar. Se não houver uma correspondência única, deve
consultar ou perguntar, sem criar outra tarefa. “Sim!” após duas opções não autoriza
uma ação por si só.
Dados do navegador e do aplicativo desktop continuam separados.

## Validação atual

Use `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
e `pnpm python:check` (Python 3.11 e uv). A instalação Node no CI usa
`pnpm install --frozen-lockfile`; Python usa `uv sync --project voice --locked`.
O workflow [CI](.github/workflows/ci.yml) agrega as validações no check obrigatório
`ci`. A compilação inclui web, servidor, Electron e worklet; os instaladores
ficam no workflow separado de tags. Não há publicação automática de release.

Na revisão local de 05/10/2026, build, tipos, lint e formatação passaram, junto
com 79 testes; 2 testes opcionais com Ollama foram ignorados. As dependências
Python foram instaladas a partir do lock e suas importações verificadas, com Ruff
e compilação dos módulos aprovados. Isso não comprova a aceitação com microfone
físico nem a execução dos instaladores nos sistemas de destino.

O [contexto de engenharia](docs/engineering/context.md) registra os limites do
projeto. A [ADR 001](docs/engineering/decisions/001-selective-security-updates.md)
registra a limitação da automação de segurança e o alerta sem patch disponível.

## Histórico de validação anterior à adoção do handbook

Os registros abaixo descrevem revisões anteriores em outro ambiente; seus
resultados e modelos instalados não representam a configuração de uma nova máquina.

TypeScript estrito na interface, no backend e no worklet passou nesta revisão.
77 testes automatizados passaram; 2 testes de HTTP locais não puderam abrir
127.0.0.1 dentro do ambiente restrito do Codex (EACCES), e 2 testes opcionais
com Ollama real foram ignorados por não haver modelo configurado para teste.
A suíte cobre tarefas consecutivas, PowerPoint a partir de ppt, VS Code,
Notepad++, destinos ausentes/ambíguos, reserva de áudio, preservação das amostras,
pausa do reconhecimento, descarte de eco atrasado e cancelamento.
A interface web foi testada com seis turnos de voz: interrupção durante geração
e reprodução com fones, proteção contra eco nos alto-falantes, retomada após a
margem, interrupção por botão, histórico preservado e execução única.
A esfera inline foi conferida em tela grande e celular, com teclado, movimento
reduzido e pausa do desenho em aba oculta. A análise de áudio mantém uma só rota
de saída, sem duplicar o som ou abrir outra captura de microfone. Microfone
e reprodução foram simulados; nenhum programa real foi aberto pelo teste de ações.
Whisper real foi executado sem reproduzir som, incluindo cancelamento
e reaproveitamento dos processos. A qualidade com seu microfone e a latência
da conversa real ainda precisam ser conferidas no uso; dependem do modelo e PC.
A exportação file:// foi testada com a ponte desktop simulada. A compilação Next
e a inicialização nativa do Electron continuam sem validação neste ambiente:
o sandbox bloqueou a canonicalização da pasta e a abertura de processos/portas.
Linux mantém o empacotamento configurado, sem teste em um sistema Linux nesta
máquina. O instalador deve ser gerado fora do ambiente restrito.

### Latência da conversa (02/10/2026)

As respostas de conversa agora aparecem por frases validadas durante a geração.
Ações continuam aguardando a decisão completa e validada; texto parcial não
executa programas nem registra tarefas. A voz pode preparar a primeira frase
em paralelo à geração, mantendo a reserva e as margens de áudio.
No modo local, uma conversa comum usa texto simples em streaming e contexto
menor quando falada; somente pedidos que podem virar tarefa ou abertura passam
pela saída JSON estruturada. Isso remove o custo de obrigar cada resposta a
montar um envelope de ferramenta, sem retirar a validação das ações.
O perfil econômico mantém o modelo por 2 minutos de inatividade, em vez de
recarregá-lo a cada turno. Somente a janela principal solicita pré-carregamento.
O histórico mostra o tempo até o primeiro texto e o tempo total separadamente.
Medição pontual com gemma4:e4b, perfil equilibrado, duas frases sobre a cor do céu:
modelo já carregado: primeiro texto 26,0 s antes; 10,2 s depois. Tempo total
26,9 s depois. Isso mede texto, não início de áudio. Carregamento inicial medido
entre 65 e 74 s. Os valores variam conforme hardware, carga e contexto.
Para latência próxima de instantânea, ainda é necessário comparar um modelo
menor ou outro provedor. Nenhum modelo foi trocado nem serviço pago ativado.

### Reprodução progressiva (02/10/2026)

A primeira frase agora pode tocar assim que preencher a reserva de áudio de
1,4 s, sem aguardar a segunda frase ou a conclusão do modelo. A margem final
de 220 ms é acrescentada ao encerrar quando ainda não estava no último bloco.
A proteção contra eco continua ativa até terminar o áudio e sua margem.
Isso elimina uma espera do aplicativo, mas não aumenta os tokens por segundo
do modelo local; um modelo lento ainda pode deixar pausas entre frases.
A referência adewaskar/jarvis usa Claude na nuvem, sessão contínua no Agent SDK
e fala por sentenças conforme o texto chega. Navegador ou ElevenLabs fornecem
a voz. O desempenho da demonstração não é um benchmark desta máquina.

### Preparação ao abrir (02/10/2026)

Em Inteligência, Manter IA pronta vem ativado e pode ser desativado para
economizar memória. A janela principal prepara o modelo ao abrir e renova
essa preparação a cada minuto. Chamadas repetidas em até 110 segundos usam
a preparação recente; trocar modelo ou perfil exige a preparação correspondente.
Ao fechar a janela ou desativar a opção, o Ollama volta a liberar o modelo
pelo prazo do perfil contado desde o último uso. Não existe descarga forçada.
O seletor exibe Carregando IA, IA pronta ou a falha de preparação. A opção
mantém o modelo na memória; não diminui seu tamanho nem a geração de tokens.
Os tempos de carregamento e resposta ainda precisam ser medidos novamente
fora do ambiente de execução restrito. Não foi gerado novo instalador.

### Modelo local de teste (03/10/2026)

Neste PC, o Ollama recebeu o qwen2.5:3b, com aproximadamente 1,9 GB, e ele
foi selecionado no Jarvis como modelo local ativo. O gemma4:e4b, de 6,6 GB,
continua instalado para comparação. Em uma execução aquecida, o qwen2.5:3b
respondeu ao teste curto em cerca de 3,6 s; o primeiro carregamento ainda é
mais demorado e depende da memória e da GPU disponíveis.

### Perfil do Jarvis (03/10/2026)

Abra Configurações > Perfil pela engrenagem lateral ou use Ctrl+K > Configurações.
Ali ficam seu nome, a forma como o Jarvis deve chamar você, o
briefing pessoal, a personalidade desejada e preferências ou limites. O perfil
é salvo no armazenamento local deste dispositivo e entra como contexto em cada
conversa; ele não altera as regras de segurança nem executa ações sozinho.
Quando a IA na nuvem estiver selecionada, o perfil acompanha a solicitação
enviada ao provedor. Para manter essas informações somente no PC, selecione um
modelo local.

### Voz local e estilo Jarvis (03/10/2026)

Na janela "Uma voz para suas ideias" ou nas opções da conversa, a voz local
gratuita permite escolher Alex (masculina), Santa (masculina suave) ou Dora
(feminina), todas do Kokoro em português brasileiro. A instalação baixa o
modelo Kokoro 82M e as três vozes brasileiras; o perfil
já começa com um preset de personalidade calmo, elegante, proativo e com humor
discreto, que pode ser substituído no campo Personalidade do Jarvis.
