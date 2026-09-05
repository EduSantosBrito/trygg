# Resumo da sessão e estado atual

Retomado em 2026-09-05, com correções adicionais de contexto, coalescing e
encerramento das atualizações granulares de listas. A versão final foi medida em
Chromium com uma fixture sem servidor HTTP. O trabalho permanece local, sem
commit ou push. A conformidade integral com o RFC e a ausência de regressões de
performance **ainda não estão demonstradas**.

## RFC e comportamento

### Continuação: profiling OTLP / SigNoz

Foi adicionada a Layer opt-in `trygg/profiling`, com spans de fase para os workers
keyed, orçamento finito, flush scoped e projeção de dados sensíveis. **19 testes
novos; 1.924 testes passaram no total**, build/typecheck/Effect diagnostics/docs
passaram. `bun run check` continua bloqueado pelos mesmos sete arquivos de
formatação preexistentes, preservados.

Os perfis finais do Chromium enviaram **15.400 spans / 2.200 traces / 33 lotes** ao
collector local, todos aceitos sem rejeição reportada, com hierarquia de pais
validada localmente. O bloqueio inicial de **401 foi resolvido**: após renomear o
secret para `SIGNOZ_API_KEY` e lançar o MCP via Infisical, uma consulta autenticada
retornou os sete spans de um trace completo, confirmando sua indexação. Isso não
reconcilia a ingestão de todos os lotes. Evidência: `profiling-mcp-validation.json`. Serviço:
`trygg-granular-profile`, UI `https://traces.brito.top`.

Preparação/render concentram a maior parcela dos tempos de fase capturados, mas
as durações incluem espera/scheduling/GC e têm resolução limitada. A comparação
off/paused/record variou bastante entre processos; não resolve a regressão
histórica H (+12,3%). Nenhuma otimização de produção foi aceita nesta etapa.
Evidência e próximos passos: [profiling-signoz.md](./profiling-signoz.md) e
`profiling-session-results.json`. O restante desta página conserva os checkpoints
anteriores, não medições feitas com profiling ligado.

### Estado da auditoria anterior

O RFC 1.1 foi copiado de `~/dev/effect-backend-quality-rfc.md` sem alterações e
incorporado ao guia de contribuição. A implementação usa o código instalado de
Effect 4.0.0-rc.112 como referência. Requisitos de persistência durável foram
separados das garantias aplicáveis ao runtime de UI, CLI e servidores gerados.

O registro histórico possui 73 achados verificados como corrigidos. Parte dessas
mudanças já existia no worktree inicial e foi preservada e revalidada; o número
não representa 73 novas correções introduzidas nesta etapa. A auditoria adicional
reproduziu e corrigiu problemas de lifecycle, concorrência e propagação de Cause.
A matriz de cláusulas ainda tem 85 entradas pendentes, duas verificadas e oito
não aplicáveis: esses registros medem escopos diferentes.

Resultados alcançados ou revalidados no estado atual:

- **Ownership e encerramento:** fibers de callbacks, renderização, recursos e
  HTTP vinculadas aos Scopes antes de executar código do usuário; rejeição de
  trabalho após início do shutdown; espera pelos finalizers antes de liberar
  serviços, incluindo respostas em streaming.
- **Falhas e cancelamento:** preservação de falhas tipadas, defects, interrupção
  e Causes combinadas; execução de todos os releases obrigatórios; rollback
  conserva a falha original e eventuais falhas da própria limpeza.
- **Renderer e reatividade:** proteção de aquisições DOM parciais, rollback de
  propriedades, identidade das linhas e Signals, ordenação, preparação sem
  executar duas vezes os mesmos Effects e serialização de atualizações suspensas.
  Serviços capturados são reutilizados por lista sem transferir ownership do Scope.
- **Router e Resource:** matching canônico e decode único; publicação coerente
  após mutação do histórico, rejeição de ativações antigas; cache com identidade,
  leases, single-flight, capacidade, expiração e encerramento verificados nos
  casos documentados.
- **Adapters, CLI e templates:** reload adquire substituto antes de retirar o
  handler saudável; startup inválido não anuncia readiness; desconexão cancela
  requests; scaffold aguarda mutações antes do rollback; revisão de autorização,
  Schemas e concorrência do template incident.
- **Observabilidade e boundaries:** projeção de dados sensíveis da instrumentação
  HTTP automática, sem alterar os Exits da aplicação; eventos de publicação de
  listas agregados; validação de URLs, parâmetros, configuração e props JSX;
  preservação de anotações nos erros e no contexto de atualizações de lista.

A etapa anterior adicionou cinco testes de contexto. Dois verificam precedência e
identidade dos serviços, estado mutável, anotações e liberação por linha. Três
reproduziram a perda do contexto da atualização mais recente após sucesso, falha
ou interrupção da preparação anterior. A fila agora conserva esse contexto e o
libera ao drenar ou encerrar a lista. Os cinco passam.

A continuação adicionou **11 testes**, totalizando 16 nessa suíte. Foram
reproduzidos o uso de anotações antigas nos callbacks granulares e o descarte da
atualização pendente após falha/interrupção. A linha agora conserva somente o
último Context pendente, retoma após o cleanup anterior e descarta referências ao
drenar, remover ou encerrar. Mil notificações durante um release suspenso geram
apenas um render posterior, sem apagar a falha tipada nem o defect do release.

Uma asserção mais forte rejeitou o candidato intermediário: o corpo da linha
preservava o serviço capturado, mas a propriedade Effect podia receber o serviço
do notificante. A versão final compõe os serviços da lista sobre o Context do
notificante uma única vez por worker, preservando as anotações atuais e o Scope
estrutural. O mesmo contrato é testado para atualizações source e granulares.

## Performance

As comparações abaixo pertencem a experimentos e checkpoints específicos. Não
somar seus ganhos, comparar tempos de fixtures diferentes nem interpretá-los
como um ganho global do framework.

| Área / cenário | Evidência local registrada |
| --- | --- |
| Resolução de 4.000 rotas planas | 28,496 → 0,060 ms/op, substituindo fibers e cópias crescentes por acumulação local |
| Matching da última entre 4.000 rotas | 12,568 → 0,151 ms/op; pathname decodificado uma vez |
| Cache com capacidade 256 | Aproximadamente 50% menos tempo de lookup e 43% menos tempo de fetch hit após os guards de shutdown |
| Construção de spans de Signals | Reutilização do combinador preserva spans independentes; comparação histórica observou cerca de 32% menos tempo para criar 10 mil linhas |
| Memória do coordenador de navegação | Aproximadamente 17,8 → 7,7 MB em 101 mil ativações, com plateau no protocolo por versão |
| Lista com propriedades Effect, atualização | 8,00 → 5,65 ms, redução observada de 29,4% |
| Mesma lista, remoção com índices alterados | 72,80 → 42,80 ms, redução observada de 41,2% |
| Dependências estáveis das linhas | 100 Maps e 100 Sets a menos em 100 atualizações; 998 de cada a menos na remoção medida |
| Captura de serviços por lista | Mais 200 Maps evitados em 100 renders, 2.000 na criação de mil linhas e 1.996 na remoção medida |

As comparações antigas de spans usavam a configuração de logging descrita no
relatório; depois corrigimos o benchmark para silenciar também o render interno.
Esses tempos antigos não são uma referência de render silencioso. Os resultados
do cache são exploratórios e sequenciais. Os de memória isolam o coordenador;
não representam a memória inteira de uma aplicação.

A preparação de linhas compatíveis com propriedades Effect elimina construção
provisória de elementos, textos e comentários em atualização, remoção e swap.
Ainda há DocumentFragments, Effects e outras alocações JavaScript. Contagem de
construtores não equivale a bytes alocados ou memória retida.

A comparação histórica anterior teve médias das medianas por processo de
23,95 ms no caminho original, 29,90 ms no checkpoint anterior e 24,85 ms com
captura de serviços. O candidato ainda ficou 3,8% acima do original, com diferença
menor que a variação entre controles. Isso **não comprova equivalência** nem
encerra a investigação da regressão. Esses números antecedem as correções das
filas e pertencem ao transporte HTTP anterior.

A nova comparação usa **a mesma fixture inline em todos os checkpoints**, com
20 warmups, 31 amostras e processos separados na ordem A–E–H–H–E–A. As médias das
medianas foram **23,65 ms no original A, 27,75 ms no histórico E e 26,55 ms na
versão final H**. H permanece **12,3% acima de A**: a regressão granular continua
aberta. Não comparar esse percentual diretamente com os 3,8% da experiência
anterior, nem atribuir a diferença inteira às últimas correções.

Os probes separados de 100 renders contaram 1.603 Maps / 700 Sets em A e
1.303 Maps / 600 Sets tanto em E quanto em H. A composição final eliminou os
100 Maps adicionais do candidato intermediário sem retirar as garantias de
contexto. Todos mantiveram zero elementos, textos e comentários provisórios.

Foram adicionados benchmarks de runtime, browser, cache, navegação, autenticação,
API de desenvolvimento e memória, com amostras brutas, versões e hashes.
Medições recentes usam processos separados, ordem intercalada, 20 warmups e 31
amostras, validação do DOM e probes de alocação separados dos timings. Estudos
sobre computação incremental, retenção de memória, warmup de VMs e documentação
primária do V8 orientaram os experimentos. Otimizações sem evidência suficiente
foram descartadas.

Testes de memória também verificaram dez ciclos de criar/limpar 10 mil linhas e
mil mounts independentes com portal: retorno das contagens DOM e plateau de
heap nos cenários medidos. Isso não prova ausência de todo vazamento nem cobre
o encerramento real de abas ou todo o grafo de bootstrap.

Na continuação, H passou por mais dez ciclos de criar/limpar 10 mil linhas e
100 mounts independentes com portal. DOM/listeners retornaram às contagens
iniciais. O heap pós-clear ficou em 8,48–8,52 MB; no trecho de mounts independentes,
subiu de 8,94 para 9,12 MB. Essa última sequência **não demonstra plateau**.
Retenção específica de Context, listas vazias e bootstrap completo seguem pendentes.

## Validação atual

- **1.905 testes passaram:** 1.714 core, 87 CLI e 104 site. São 11 testes a mais
  que no ponto de pausa anterior e 294 sobre a primeira baseline de 1.611.
- Build do core, tipos do workspace e benchmarks, fixtures públicas de tipos,
  diagnóstico Effect e lint passaram, este último com os dois warnings anteriores.
- **`bun run check` não está verde:** a formatação inclui sete arquivos em três
  diretórios `packages/core/trygg-test-*`, já presentes como untracked na entrada
  da tarefa. Eles foram preservados, sem remoção ou reformatação. Uma verificação
  separada excluindo exatamente esses três diretórios passou; os demais gates
  foram executados individualmente.
- Contrato de documentação: 340 exports; builds de exemplos e site; diff check:
  todos passaram. Permanecem avisos anteriores de lint, sugestões Schema no
  release script e tamanho de chunks do site.
- Na sessão anterior, a execução completa precisou da autorização para sockets locais. Após
  timeout da primeira autorização e EPERM no sandbox, a nova tentativa permitida
  executou a suíte com exit zero.
- O bloco final de browser validou seis execuções cronometradas, três probes e
  nove operações smoke, sem mensagens de console nas operações. Os hashes de A/E
  correspondem aos artefatos históricos, e os de H ao código final. O modo inline
  intercepta todas as requisições e não mede rede, HTTPS, startup ou lazy loading.

## Próximos passos, em ordem

1. Investigar a diferença granular de 12,3% observada no novo bloco, separando
   trabalho ativo, scheduling e GC, com fixtures equivalentes e host dedicado. Incluir
   listas vazias, alocações e memória retida pela captura de Context.
2. Completar a auditoria de contexto dos callbacks granulares e componentes
   aninhados, incluindo coalescing, reentrância e shutdown. Expandir preparação
   e rollback para reconciliação parcial de filhos keyed e valores reativos.
3. Fechar a matriz do RFC cláusula por cláusula, por módulo aplicável: serviços,
   Layers, composição, boundaries, observabilidade, overload, segurança e lifecycle.
   Associar código e testes a cada fechamento; não inferir cobertura integral
   a partir dos 73 achados históricos.
4. Ampliar benchmarks para aplicações representativas, pressão/expiração de cache,
   fanout, bootstrap completo, bundle e memória. Consolidar uma comparação final
   consistente, sem misturar os checkpoints históricos.
5. Reexecutar todos os gates e revisar o diff consolidado antes de qualquer
   conclusão de conformidade integral e ausência de regressões.

Referências: [auditoria completa](./end-to-end-audit.md),
[achados históricos](./historical-findings-audit.md),
[pesquisa, medições e amostras](./performance-research.md),
[validação desta continuação](./keyed-granular-validation.json),
[adoção inicial e baseline](./trygg-adoption.md).
