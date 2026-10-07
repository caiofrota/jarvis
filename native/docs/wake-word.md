# Escolher e treinar a palavra de ativação

A imagem contém **um único modelo**. O padrão é Okay Nabu v2, de Kevin Ahrendt.
Mudar o nome exibido no painel não muda o detector. Para outra palavra, selecione
outro modelo compatível antes de compilar e grave a nova aplicação.

```sh
python3 tools/select_wake.py /caminho/meu_modelo.json --sha256 HASH_DO_TFLITE
make build
```

O JSON acompanha um `.tflite` quantizado e exportado em modo streaming v2. O
seletor verifica versão, cabeçalho, tamanho, checksum quando fornecido, parâmetros
do frontend e limite de arena. O runtime ainda precisa aceitar as operações e
formas dos tensores; um `.tflite` genérico não é suficiente. O cabeçalho gerado
fica fora do Git. `make model` seleciona novamente o modelo padrão.

O treinamento usa o projeto [microWakeWord](https://github.com/OHF-Voice/micro-wake-word)
e seu [notebook de treinamento](https://github.com/OHF-Voice/micro-wake-word/tree/main/notebooks).
É um trabalho separado da gravação; o miniPC não precisa treinar para executar
um modelo pronto. A documentação upstream avisa que obter um modelo confiável
exige experimentação, não apenas executar o notebook uma vez.

Um caminho para uma frase como **Acorda Rosie**:

1. Escolher uma frase distintiva e reunir exemplos positivos variados em pt-BR,
   com vozes, distâncias, velocidades e o seu sotaque. Gravações próprias ajudam
   a avaliar o microfone real; exemplos sintéticos ampliam a variação.
2. Preparar exemplos negativos: conversa normal, televisão, música, ruído e frases
   parecidas. Separar treino, validação e teste, evitando a mesma gravação ou voz
   sintética quase idêntica nos três conjuntos.
3. Seguir o pipeline do projeto para extrair as características, treinar e exportar
   o modelo quantizado streaming. GPU/Colab pode ajudar no treino; não é exigida
   para rodar a inferência no ESP.
4. Medir rejeições de chamadas reais e ativações falsas por hora de áudio de fundo.
   Ajustar limiar e janela somente com um conjunto de validação separado.
5. Gravar apenas o modelo aprovado e medir memória, tempo de processamento e
   reconhecimento no WROOM com o restante do firmware funcionando.

Há um primeiro modelo experimental **Acorda Rosie**, treinado localmente e
instalado neste WROOM. O usuário confirmou que “Acorda Rôzi” acordou o robô e
recebeu uma resposta falada. O modelo padrão para novas instalações continua
sendo Okay Nabu. Não há upload automático de gravações para treino.

## Preparação de Acorda Rosie

A chamada escolhida para o primeiro modelo personalizado é **Acorda Rosie**.
O nome deve aceitar R americano e a pronúncia brasileira **Rôzi/Rose**, com a
primeira sílaba tônica. **Oi Rosie** fica como alternativa a avaliar, ainda sem
promessa de reconhecimento. Podemos incluir duas chamadas no mesmo detector,
mas precisamos treinar e medir ambas; o primeiro experimento mantém uma frase.

A [receita de pronúncias](../training/acorda_rosie.json) registra esses sons,
frases parecidas para exemplos negativos e a revisão do treinador upstream.
Ela é um plano de dados do projeto, não um manifesto de modelo ou um arquivo de
configuração diretamente aceito pelo treinador.

Para gerar as amostras iniciais com os modelos Kokoro já instalados:

```sh
.venv/bin/python tools/preview_wake_pronunciations.py
```

O comando usa um único thread de inferência, verifica os hashes dos modelos e
produz 12 WAVs de 16 kHz mono em `artifacts/wake/acorda_rosie/preview/`, junto
com um manifesto contendo pronúncia, voz, duração e checksum de cada amostra.
Não chama APIs, não grava o microfone, não altera a voz da conversa e não instala
um detector. As amostras são rascunhos sintéticos para ouvir antes de produzir
o conjunto completo; três vozes do mesmo sintetizador não bastam para comprovar
reconhecimento da voz humana.

As pronúncias são explícitas porque a conversão automática inspecionada gerou
sons indesejados para esses nomes. O símbolo `O` da receita é a convenção do
Kokoro para o ditongo americano. Esses fonemas precisam ser conferidos pelo ouvido,
não apenas pela grafia ou por uma transcrição automática.

Depois de conferir as amostras, o treinamento ainda precisa de:

1. Exemplos positivos variados das duas pronúncias, incluindo gravações humanas.
   Reservar pessoas/sessões ou vozes para avaliação; versões aumentadas de um mesmo
   áudio ficam sempre no mesmo conjunto, evitando vazamento entre treino e teste.
2. Exemplos negativos em português, frases confundíveis e áudio ambiente como
   teclado, buzina, TV e silêncio. As chamadas alternativas em avaliação não devem
   ser rotuladas automaticamente como negativas.
3. Extração de características e treinamento seguindo o
   [notebook upstream fixado](https://github.com/OHF-Voice/micro-wake-word/blob/4665173cd35f1cff9a61e06fc427f124766c488e/notebooks/basic_training_notebook.ipynb).
   Seu gerador padrão é inglês; substitua a geração de positivos pelo conjunto
   pt-BR preparado. O treino deve usar ambiente separado do servidor de voz.
4. Avaliação separada por pronúncia, distância e ruído, relatando chamadas perdidas
   e ativações falsas por hora. Amostras de conferência não são avaliação final.
5. Exportação streaming quantizada v2 e verificação de operações, memória e
   tempo de inferência no WROOM antes de substituir o modelo instalado.

**Estado atual:** as duas pronúncias foram aprovadas em 22/09/2026. O primeiro
treinamento terminou com 520 exemplos sintéticos e 10 mil etapas, em ambiente
separado do servidor. O candidato experimental foi instalado e respondeu ao
primeiro teste humano com “Acorda Rôzi”.

A avaliação sintética separada reconheceu 96,7% dos exemplos brasileiros e 71,7%
dos americanos. Houve duas detecções em exemplos de uma frase negativa e duas
em 5,3 horas de áudio de fundo. Portanto, o modelo ainda precisa de melhorias;
esse teste não comprova reconhecimento confiável em todos os ambientes. A versão
com Okay Nabu foi preservada para retorno. Veja o
[registro de validação e retorno](validation.md).

Os comandos e limites do experimento ficam no
[guia técnico de treinamento](../training/README.md). Os testes sintéticos ajudam
a escolher um candidato, mas não substituem o teste com sua voz e o microfone real.
