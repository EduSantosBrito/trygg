# Revisao do uso de Effect segundo o RFC de qualidade

Data da revisao: 2026-08-27

RFC de referencia: `/home/host/dev/effect-backend-quality-rfc.md`, versao
`1.0-draft`, SHA-256
`7f0664aeba5e9da37ebe18101c18ca41ef80955a183a963b8ac15df7cbdb5a42`.

Snapshot revisado: commit `00326e221e4892976f021c8db7de8ea824ef4079` mais o
estado nao commitado presente durante a revisao. Como o worktree ja continha
alteracoes, os achados descrevem o estado observado, nao apenas o `HEAD`.

## Escopo e metodo

Foram revisados `packages/core`, `packages/cli` e os templates publicados pelo
CLI. O diretorio `scratch/` foi excluido explicitamente. Aplicacoes consumidoras
em `apps/` nao foram tratadas como implementacao do framework.

O RFC e direcionado a backends. Portanto, seus requisitos foram aplicados
somente quando a precondicao existe no framework. Persistencia autoritativa,
transacoes, durable delivery, migrations, Effect Workflow, Activities, filas
duraveis e cache remoto ou persistente nao foram usados como criterios de
reprovacao porque essas capacidades nao existem no escopo revisado.
Falhas exclusivas de UI/browser foram mantidas como recomendacoes extrarrfc
porque afetam primitives publicas do framework, mas nao foram tratadas como
violacoes normativas. Nesses casos, a clausula citada e apenas uma analogia
orientadora; usar Schema, Cause, Fiber ou Scope no frontend nao amplia o escopo
backend definido pelas secoes 3.1, 3.3 e 3.4.

As verticais auditadas foram:

| Vertical | Escopo principal |
| --- | --- |
| Runtime de renderizacao | Component, Element, Renderer, transacoes de render e boundaries |
| Sinais e reatividade | Signal, render reativo, keyed lists e sincronizacao |
| Recursos assincronos | Resource, cache local, single-flight e invalidacao |
| Router | Navegacao, ativacao, Outlet, prefetch, schemas e strategies |
| Adapters de browser | DOM, eventos, observers, idle, history, location, scroll e storage |
| Build e transporte | Vite, dev platforms, artefatos Bun/Node/Cloudflare e API gerada |
| CLI e templates | Composition root, prompts, filesystem, scaffold e template `incident` |
| Observabilidade | Trace, Debug, Metrics, eventos e tratamento de Cause |
| Contratos de dados | Schema, erros tipados, configuracao, URL e boundaries publicos |
| Testes | Seams de producao, tempo, concorrencia, interrupcao e finalizacao |
| Composicao | Services, Layers, compartilhamento, isolamento e roots executaveis |
| Compatibilidade Effect v4 | APIs e peers da versao fixada `4.0.0-rc.112` |

A revisao combinou leitura estatica, type-level/build gates e probes
deterministas com `Deferred`, `Ref`, `Exit`, `Cause`, `TestClock`, native fakes e
Scheduler controlado. Probes descartaveis ficaram em `/tmp/opencode`; nenhum foi
adicionado ao repositorio. Toda recomendacao de API Effect foi confrontada com
as declaracoes e fontes instaladas de `4.0.0-rc.112`, nao com documentacao de v3
ou da versao latest.

Em cada achado, **Evidencias** localiza o gatilho, e **Por que falhou** descreve a
garantia perdida e seu impacto concreto. **Ganhos esperados** descreve o inverso
observavel da correcao; o criterio de aceite indica como transformar a reproducao
em evidencia persistente.

### Aplicabilidade do RFC

| Bloco | Decisao nesta revisao |
| --- | --- |
| Secoes 5-10 e 12 | Aplicadas normativamente aos componentes backend/CLI; usadas apenas como analogia em UI/browser |
| Secao 11 | Nao aplicada normativamente; 11.5 aparece apenas por analogia em mutacoes UI concorrentes, e repositorios/transacoes/eventos duraveis/migrations nao existem |
| Secoes 13-14 | Nao aplicadas: nao ha port Stream nem Workflow/Activity/durable background work no framework revisado |
| Secao 15 | Requisitos remotos/persistentes nao se aplicam; `Resource` local foi revisado apenas por analogia |
| Secoes 16-19 | Aplicadas a HTTP/filesystem/processo, API backend do template e seus testes; browser/UI apenas por analogia |
| Secoes 20 e 22 | Revisadas; nenhuma preferencia de organizacao ou extension point foi elevada sem impacto material |
| Secoes 21 e 23 | Aplicadas somente onde existe input invalido, readiness, overload, runtime ou cache correspondente |
| Secao 24 | Considerada para readiness/shutdown do servidor gerado; estados de delivery, Workflow e administracao nao existem |
| Secoes 25-26 | Nao usadas como criterio: nao ha acao IANA nem requisito de identidade/localizacao correspondente |
| Secao 27 | Aplicada a input/autorizacao HTTP e CLI efetivamente presentes; `SafeUrl` browser foi apenas analogia e isolamento multi-tenant nao foi presumido |

## Baseline executado

| Comando | Resultado |
| --- | --- |
| `bun run build` | Passou |
| `bun run typecheck` | Passou, incluindo build e type tests do core |
| `bun run --cwd packages/core effect:check` | Passou: 154 arquivos, zero diagnosticos |
| `bun run --cwd packages/core docs:check` | Passou: 342 exports alcancaveis |
| `bun run typecheck:templates` | Falhou: tres Route Components do template `incident` ainda exigem Services |
| `bun run --cwd packages/core test` | Falhou antes da coleta: 68 suites, zero testes executados |
| `bun run --cwd packages/cli test` | Falhou: o pacote nao define script `test`; import direto da suite encontra a mesma incompatibilidade Vitest |
| `bun run lint` | Falhou: um arquivo `.ts` contem JSX e `ComponentYieldable` usa requirement `unknown` |

Passar no typecheck e no Effect Language Service nao foi considerado evidencia
suficiente para propriedades de concorrencia, cancelamento ou lifecycle.

## Criterio de inclusao

Uma clausula `MUST` ou `MUST NOT` aplicavel a um componente backend foi registrada
como violacao normativa. Uma clausula `SHOULD`, `SHOULD NOT`, review decision ou
analogia frontend so foi incluida quando havia uma cadeia concreta de gatilho,
garantia perdida e impacto observavel. Preferencias de estilo e diferencas em
relacao aos exemplos do RFC foram descartadas.

`Recomendacao concreta` identifica um default/review decision aplicavel ou um
bloqueador de evidencia sem `MUST` violado. `Recomendacao extrarrfc` identifica
uma falha frontend concreta cuja clausula e usada somente por analogia.

As severidades indicam impacto:

| Severidade | Criterio |
| --- | --- |
| Critica | Violacao exploravel ou corrupcao sistemica de identidade/lifecycle em primitive publica |
| Alta | Quebra de contrato publico, isolamento, interrupcao, ownership de trabalho/recurso ou indisponibilidade ampla |
| Media | Falha material de correcao, recovery, readiness, observabilidade ou adapter, mas limitada e recuperavel |
| Baixa | Risco local de manutencao ou ruido operacional sem quebra atual de contrato ou lifecycle |

## Sintese executiva

| Classe | Critica | Alta | Media | Baixa | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Violacao normativa | 0 | 12 | 5 | 0 | 17 |
| Recomendacao concreta | 0 | 2 | 8 | 0 | 10 |
| Recomendacao extrarrfc | 3 | 34 | 8 | 1 | 46 |
| **Total** | **3** | **48** | **21** | **1** | **73** |

O estado observado nao sustenta uma declaracao de conformidade com as clausulas
backend aplicaveis do RFC: ha 17 violacoes normativas. Build, typecheck,
documentacao e Effect Language Service passam, mas nao provam ownership de
runtime/processo, preservacao de Cause/interruption, decoding HTTP ou lifecycle
dos adapters server. O runner oficial executar zero testes permanece um
bloqueador de evidencia independente, nao uma violacao normativa por si so.

Os tres riscos criticos sao frontend e, portanto, extrarrfc:

| ID | Risco imediato |
| --- | --- |
| EFFECT-023 | O cache `Resource` pode devolver a consumidores um Signal compartilhado ja disposto pelo primeiro Component |
| EFFECT-030 | Formas que o browser canonicaliza para `javascript:` atravessam `SafeUrl` e chegam ao sink DOM |
| EFFECT-031 | A policy URL global libera schemes ativos e deixa `action`, `formAction` e `srcSet` sem policy propria |

## Achados

Os achados abaixo estao agrupados pela vertical que possui a correcao. Quando um
problema cruza mais de uma vertical, ele aparece uma unica vez e referencia as
demais garantias afetadas.

### Toolchain e testes

#### EFFECT-001 - O runner e incompativel com `@effect/vitest` e nenhuma suite executa

Severidade: **Alta**. Classe: **recomendacao concreta**.

Evidencias: `packages/core/package.json:85,91` e
`packages/cli/package.json:40,43` fixam `@effect/vitest@4.0.0-rc.112`, mas ainda
resolvem `vitest@3.2.4`. O peer da versao instalada de `@effect/vitest` exige
`vitest >=4.1.0 <5.0.0`. `bun run --cwd packages/core test` encerra durante a
importacao de `vitest.setup.ts:6`, com `getCurrentSuite` indefinido: 68 suites
falham e zero testes sao coletados. O mesmo erro ocorre ao importar a suite do
CLI.

1. **Referencia orientadora do RFC:** secao 5.1, "Quality Verticals" (`SHOULD`: uma vertical critica identifica tests/checks que fornecem evidencia), e secao 19.1, "Subject and Seams" (quando existe, o teste deve exercitar o sujeito real pelo seam de producao). Nenhuma dessas clausulas exige que uma suite exista ou passe; o achado e um bloqueador de evidencia, nao uma violacao normativa.
2. **Por que falhou:** a atualizacao de Effect de `4.0.0-beta.58` para `4.0.0-rc.112` atualizou `@effect/vitest`, mas manteve o runner na major anterior. O typecheck aceita as declaracoes, porem a integracao usa internals de runtime disponiveis somente no Vitest 4.1 ou posterior. Assim, toda a evidencia de lifecycle, concorrencia, interrupcao, adapters e boundaries desaparece antes do primeiro teste.
3. **Possivel solucao:** alinhar `vitest` de `packages/core` e `packages/cli` ao peer de `@effect/vitest`, preferencialmente por uma unica versao no catalogo do workspace; regenerar o lockfile; adaptar configuracao ou assertions afetadas pela migracao; e exigir uma execucao completa das suites antes de considerar a atualizacao de Effect concluida.
4. **Ganhos esperados:** restaura a barreira de regressao do framework e os testes que deveriam provar Scope, finalizacao, cancelamento e semantica de erro. Tambem volta a tornar executaveis os jobs de PR, release e publish que chamam `bun run test` em `.github/workflows/pr.yml:39-40`, `.github/workflows/release.yml:65-66` e `.github/workflows/publish.yml:37-38`.
5. **Possiveis side effects:** Vitest 4 pode exigir ajustes de configuracao, ambiente DOM, reporters, snapshots e helpers. A suite restaurada provavelmente revelara falhas adicionais hoje mascaradas pelo erro de bootstrap; isso e evidencia nova a tratar, nao motivo para manter o runner incompativel.

Criterio de aceite: as dependencias resolvidas satisfazem o peer declarado e os
comandos de teste do core e do CLI coletam e executam suas suites sem erro de
bootstrap.

### Adapters de browser

#### EFFECT-002 - O Layer live de `LocalStorage` esta ligado ao backend de sessao

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `packages/core/src/platform/storage.ts:105-113` constroi tanto
`sessionStorageBrowser` quanto `localStorageBrowser` com
`makeStorageBrowserLayer(() => sessionStorage)`. O port nomeado `LocalStorage`
nunca acessa `globalThis.localStorage`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 16.3, "External APIs" (`MUST`: conter o comportamento externo e traduzir falhas de protocolo antes de retornar ao dominio), e secao 21.6, "Unsupported Adapter Behavior" (`MUST NOT`: enfraquecer silenciosamente o contrato do port).
2. **Por que falhou:** o wiring seleciona o adapter errado. Chamadas bem-sucedidas pelo Service `LocalStorage` possuem duracao de sessao e namespace de `sessionStorage`, contrariando a identidade e a persistencia prometidas pelo port sem produzir qualquer falha visivel.
3. **Possivel solucao:** alterar a factory de `localStorageBrowser` para `makeStorageBrowserLayer(() => localStorage)` e adicionar um caso de conformance live que forneca stores distintos e prove isolamento para a mesma chave.
4. **Ganhos esperados:** restaura persistencia entre sessoes, compartilhamento esperado entre abas e separacao correta entre os dois Services.
5. **Possiveis side effects:** consumidores que acidentalmente dependiam de dados gravados em `sessionStorage` pelo port errado deixarao de encontra-los por `LocalStorage`. A mudanca e observavelmente breaking, mas corrige o contrato publicado.

Criterio de aceite: com os dois backends controlados, gravar a mesma chave pelos
dois Services produz valores independentes e cada Layer toca somente seu backend.

#### EFFECT-003 - Registro de listeners e observers nao e atomico com o finalizer

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: o listener e instalado antes de `Effect.addFinalizer` em
`packages/core/src/platform/event-target.ts:87-94`; o callback idle e agendado
antes do finalizer em `packages/core/src/platform/idle.ts:66-73`; e
`MutationObserver.observe` precede o finalizer em
`packages/core/src/platform/observer.ts:181-193`. O
`IntersectionObserver` tambem e construido antes de registrar seu finalizer em
`packages/core/src/platform/observer.ts:146-160`. O template publicado repete a
janela ao chamar `Signal.subscribe` antes de `Effect.addFinalizer` em
`packages/cli/templates/incident/app/components/command-palette.tsx:110-133`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.4, "Interruption" (`MUST`: manter interrupcao observavel atraves do cleanup), secao 12.4, "Resource Acquisition" (`MUST`: todo recurso que exige release deve ter owner estrutural e finalizer), e secao 16.3, "External APIs" (`MUST`: finalizar recursos nativos mesmo quando uso ou decodificacao falha).
2. **Por que falhou:** cada implementacao executa aquisicao e registro do finalizer como dois Effects interrompiveis. Uma interrupcao entre esses passos deixa listener, idle callback ou observer ativo sem cleanup registrado. O Scope existe, mas ainda nao conhece o recurso nessa janela.
3. **Possivel solucao:** expressar cada par com `Effect.acquireRelease`. A aquisicao registra o listener, agenda o callback ou constroi e inicia o observer; o release remove, cancela ou desconecta e trata/reporta internamente qualquer throw, pois o finalizer scoped precisa terminar com erro `never`. Manter a pequena aquisicao sincrona na regiao nao interrompivel criada pelo combinador.
4. **Ganhos esperados:** elimina leaks sob interrupcao e torna a propriedade de cleanup estrutural, em vez de depender de timing entre dois yields.
5. **Possiveis side effects:** o registro sincrono fica brevemente nao interrompivel, que e a garantia necessaria. Falhas de release precisam de uma politica de reporte que nao substitua o resultado de negocio nem transforme shutdown normal em erro espurio.

Criterio de aceite: testes deterministas interrompem durante cada aquisicao e
provam que toda chamada de register/observe/request/subscribe possui exatamente
uma chamada correspondente de remove/disconnect/cancel/unsubscribe.

#### EFFECT-004 - Falhas nativas esperadas sao declaradas como impossiveis e viram defects

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `EventTargetError`, `ObserverError` e `IdleError` existem em
`packages/core/src/platform/event-target.ts:16-22`,
`packages/core/src/platform/observer.ts:15-18` e
`packages/core/src/platform/idle.ts:14-17`. Apesar disso, os contratos declaram
erro `never` em `event-target.ts:28-35`, `observer.ts:24-48` e
`idle.ts:23-27`. Construcao de observers e chamadas como `addEventListener`,
`dispatchEvent`, `observe`, `requestIdleCallback` e seus releases sao diretas ou
envolvidas por `Effect.sync` em `event-target.ts:78-99`,
`observer.ts:133-194` e `idle.ts:61-73`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.1, "Typed Failures" (`MUST`: falhas externas e operacionais esperadas permanecem no canal tipado), secao 16.1, "Configuration" (`MUST`: readiness assincrona remanescente deve ser explicita), e secao 16.3, "External APIs" (`MUST`: conter throws e comportamento nativo em falhas project-owned).
2. **Por que falhou:** opcoes invalidas, `MutationObserverInit` invalido, APIs ausentes e operacoes DOM que lancam sao resultados operacionais previsiveis do boundary. `Effect.sync` captura o throw somente como defect, e as assinaturas `never` impedem `catchTag` ou traducao deliberada. Em ambientes sem suporte, o Layer ainda aparenta fornecer um Service pronto.
3. **Possivel solucao:** envolver construcao, registro e operacoes normais do handle com `Effect.try`, construindo o erro tipado correspondente e atualizando interfaces. Releases instalados por `Effect.acquireRelease`/`addFinalizer` devem capturar e reportar sua falha internamente e terminar com erro `never`; se fechamento tipado fizer parte do contrato publico, expo-lo como operacao explicita ou usar `acquireUseRelease`. Quando ausencia da API torna todo o Service inutil, falhar a aquisicao do Layer.
4. **Ganhos esperados:** consumidores podem recuperar, traduzir e observar falhas previstas; readiness deixa de ser falsa; os tres tipos de erro passam a representar contratos reais.
5. **Possiveis side effects:** os novos erros se propagam para Router, Renderer e aplicacoes consumidoras, exigindo handlers ou `mapError`. Fazer a validacao na aquisicao tambem pode antecipar uma falha que hoje aparece somente no primeiro uso.

Criterio de aceite: native fakes que lancam em construcao, registro, dispatch e
observe resultam em `Cause.fail` com a tag/operacao corretas; throw de release e
reportado uma vez sem impedir os demais finalizers; ambiente sem API obrigatoria
nao fornece um Service pronto.

#### EFFECT-005 - Callbacks podem escapar do runtime e suas falhas nao sao observadas

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: os thunks `handler(e)`, `options.onIntersect(entry)`,
`handler(mutations)` e `handler()` sao avaliados antes de serem submetidos a
`forkIn` em `packages/core/src/platform/event-target.ts:82-85`,
`packages/core/src/platform/observer.ts:146-151,181-184` e
`packages/core/src/platform/idle.ts:66-68`. Os retornos de `runForkWith` e das
fibers criadas sao descartados nesses mesmos pontos. O template publicado
descarta `Effect.runFork` de callbacks de `keydown` e `matchMedia` em
`packages/cli/templates/incident/app/layout.tsx:18-35` e
`app/services/theme.ts:92-127`; remover o listener nao interrompe trabalho ja
iniciado.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.1, "Structured Ownership" (`MUST`: o owner de todo trabalho forkado deve poder observar falha, interromper e aguardar finalizacao), e secao 16.3, "External APIs" (`MUST`: conter comportamento callback no adapter). A secao 10.2 permite que um throw inesperado seja defect, mas nao que ele escape do runtime que deveria possui-lo.
2. **Por que falhou:** chamar o thunk antes de `Effect.suspend` permite que um throw ocorrido ao construir o Effect atravesse sincronicamente o callback do browser. Quando o thunk retorna um Effect e a fiber falha depois, o Scope consegue interrompe-la no fechamento, mas nenhum owner consome sua saida; o defect pode desaparecer sem sinal operacional.
3. **Possivel solucao:** submeter `Effect.suspend(() => handler(...))` ao owner scoped e adotar supervisao que observe a saida, por exemplo um `FiberSet` scoped cujo `join` tenha owner, ou um reporter unico que ignore interrupcao normal e preserve/reemita o Cause conforme o contrato.
4. **Ganhos esperados:** todos os throws e falhas passam pelo runtime Effect, preservando tracing, interrupcao e diagnostico; defects de event handlers deixam de escapar ao host ou desaparecer silenciosamente.
5. **Possiveis side effects:** um throw deixa de propagar na pilha sincrona do browser e passa a ser observado assincronamente pela politica escolhida. O reporter pode criar ruido ou duplicacao se interrupcao normal e falhas ja tratadas nao forem filtradas.

Criterio de aceite: um thunk que lanca antes de retornar nao escapa do callback
nativo, uma fiber que morre chega exatamente uma vez ao owner/reporter, e fechar o
Scope interrompe trabalho pendente sem reporta-lo como falha operacional.

#### EFFECT-006 - Operacoes do adapter DOM podem reportar sucesso ou consultar fora do boundary

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: `Reflect.set` tem seu retorno booleano ignorado em
`packages/core/src/platform/dom.ts:272-278`; `querySelectorAll` faz fallback para
o `document` global quando recebe um root que nao reconhece em
`packages/core/src/platform/dom.ts:300-310`, enquanto `querySelector` retorna
`null` para o mesmo input em `dom.ts:288-298`; e `head`, `body` e
`documentElement` sao tipados como nao nulos, mas retornam as propriedades do
document sem validar readiness em `dom.ts:318-331`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 16.1, "Configuration" (`SHOULD`: Service que exige inicializacao esta pronto quando o Layer o fornece), secao 16.3, "External APIs" (`MUST`: traduzir falhas de protocolo em falhas project-owned), e secao 21.6, "Unsupported Adapter Behavior" (`MUST NOT`: enfraquecer silenciosamente o contrato do port).
2. **Por que falhou:** `Reflect.set` pode retornar `false` sem lancar e hoje produz `Success` sem mutacao; um root invalido amplia silenciosamente a query para todo o documento; e documents ainda nao prontos podem produzir `null` em um Effect cujo tipo promete `Element`. Nos tres casos, sucesso nao preserva o contrato declarado.
3. **Possivel solucao:** falhar com `DomError` quando `Reflect.set` retorna `false`; restringir root a `ParentNode` e consultar diretamente nele, falhando para input runtime invalido em vez de usar fallback global; validar `head`, `body` e `documentElement` ou estabelecer readiness antes de fornecer o Service.
4. **Ganhos esperados:** sucesso volta a significar mutacao efetiva, queries preservam isolamento de subtree e valores impossiveis deixam de escapar pelo tipo.
5. **Possiveis side effects:** callers que passam `Node` generico podem precisar estreitar para `ParentNode`; escritas antes ignoradas passam a falhar; acesso ao DOM muito cedo passa a falhar ou aguardar explicitamente.

Criterio de aceite: propriedade nao gravavel falha tipadamente; nenhum root
invalido retorna matches do document global; e document sem elementos estruturais
produz a falha/readiness documentada, nunca sucesso com `null` oculto pelo tipo.

### Runtime de renderizacao

#### EFFECT-007 - Fibers de rerender nao sao registradas no Scope de render

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `runForkInRenderContext` executa
`Effect.runForkWith(...)(effect.pipe(Scope.provide(renderContext.scope)))` e
descarta a Fiber em `packages/core/src/primitives/renderer.ts:104-123`. Esse
helper inicia rerenders em `packages/core/src/primitives/render-component.ts:401-404`
e tambem trabalho reativo e de recovery em `render-signal-element.ts:147-268`,
`render-keyed-list.ts:851-865` e `render-error-boundary.ts:130-156`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.1, "Structured Ownership" (`MUST`: todo trabalho forkado possui owner capaz de observar falha, interromper e aguardar finalizacao), e secao 23.5, "Startup and Shutdown" (`SHOULD`: shutdown interrompe fibers possuidas e fecha recursos em ordem de Scope).
2. **Por que falhou:** fornecer `Scope.Scope` no environment permite que o Effect adquira recursos naquele Scope, mas nao registra automaticamente a propria Fiber criada por `runForkWith`. Fechar o mount Scope pode finalizar recursos e ainda deixar o rerender suspenso vivo; quando ele retoma, pode voltar a mutar DOM desmontado.
3. **Possivel solucao:** registrar a Fiber retornada por `runForkWith` com `Fiber.runIn(renderScope)` e observar seu Exit por uma unica policy; o fechamento do Scope interrompe e aguarda essa Fiber, embora `runIn` retorne imediatamente no callsite. Se o owner precisar observar o conjunto, usar `FiberSet.make` mais `FiberSet.runtime(set)` e `FiberSet.join(set)`; `FiberSet.makeRuntime` sozinho nao expoe o set. Em codigo ja dentro de um Effect, `Effect.forkIn` fornece o mesmo ownership de fechamento, mas a observacao de falha continua explicita.
4. **Ganhos esperados:** unmount cancela renders obsoletos, impede ressurreicao de DOM e aguarda os finalizadores do trabalho antes de concluir cleanup.
5. **Possiveis side effects:** renders suspensos passam a receber interrupcao durante unmount. Qualquer trabalho que deva sobreviver ao subtree precisara de handoff explicito para um Service com lifetime maior.

Criterio de aceite: bloquear um rerender em `Deferred`, fechar o Scope e liberar o
gate produz Cause interrompida, executa finalizadores e nao reinsere nenhum node.

#### EFFECT-008 - Event handlers pertencem ao mount, nao ao subtree que fornece seus Services

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: os snapshots de evento copiam sempre `renderContext.scope` em
`packages/core/src/primitives/render-intrinsic.ts:121-125,327-334`; esse Scope e
criado no mount em `packages/core/src/primitives/renderer.ts:614-628`, mesmo
quando o node esta sob Component, keyed row ou Layer com lifetime menor. Cada
evento cria uma Fiber e adiciona manualmente `Fiber.interrupt(fiber)` como
finalizer do mount em `render-intrinsic.ts:135-142,355-364`, sem remover o
finalizer quando a Fiber termina. Os thunks `value(event)` tambem sao avaliados
antes de entrar no Effect nesses pontos.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 9.3, "Placement and Sharing" (`SHOULD`: placement considera identidade, lifetime e isolation boundary), secao 12.1, "Structured Ownership" (`MUST`: owner observa, interrompe e aguarda toda Fiber), e secao 16.3, "External APIs" (`MUST`: conter comportamento callback dentro do adapter).
2. **Por que falhou:** um handler pode continuar depois que o provider local e seus recursos ja foram finalizados, usando Services capturados fora do lifetime valido. Mesmo handlers concluidos deixam um finalizer retido ate o unmount raiz. Alem disso, um throw ao avaliar `value(event)` escapa sincronicamente pelo callback DOM antes de existir uma Cause Effect.
3. **Possivel solucao:** propagar o Scope local de Component/provider/row no `RenderContext` dos descendentes; avaliar o thunk com `Effect.suspend(() => value(event))`; e submeter a Fiber a um `FiberSet` local que a remove ao terminar, observa sua saida e permite ao teardown interromper e aguardar o conjunto.
4. **Ganhos esperados:** elimina use-after-finalize, limita retencao de Context e finalizers, e faz throws de handlers passarem por tracing, interrupcao e policy de erro do framework.
5. **Possiveis side effects:** remover uma row ou Component passa a interromper handlers em andamento. Acoes que precisem sobreviver devem fazer handoff explicito; testes que hoje exigem sobrevivencia apos remocao, como `keyed-list-row-scope.test.tsx:218-276`, precisarao refletir o ownership correto.

Criterio de aceite: remover um subtree provido interrompe o handler antes de
finalizar o provider; throw sincrono nao chega a `window.error`; e uma sequencia de
handlers concluidos nao aumenta continuamente os finalizers do mount.

#### EFFECT-009 - O merge de Context faz o root sobrescrever providers locais

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `mergeRenderServices` usa
`Context.merge(context, renderContext.services)` em
`packages/core/src/primitives/renderer.ts:104-108`; snapshots dos dois caminhos
de event handler repetem a mesma ordem em
`packages/core/src/primitives/render-intrinsic.ts:121-125,327-334`. Na API Effect
v4 instalada, o segundo Context vence em tags colidentes. Assim, um Service do
mount substitui o provider lexical mais proximo justamente nos Effects
disparados depois do render.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 9.3, "Placement and Sharing" (`SHOULD`: placement deve preservar identidade, lifetime e isolation boundaries).
2. **Por que falhou:** a ordem do merge inverte a semantica de shadowing. O corpo renderizado pode observar o Service local, enquanto seu clique ou rerender observa a instancia raiz. Para estado local, locale ou adapters substituidos, isso cruza a boundary declarada sem sinal no tipo.
3. **Possivel solucao:** inverter para `Context.merge(renderContext.services, context)` em todos os snapshots e helpers, centralizando essa operacao para impedir nova divergencia.
4. **Ganhos esperados:** provider lexical volta a determinar a instancia usada em render, handler e trabalho agendado; identidade e isolamento permanecem consistentes durante todo o lifecycle.
5. **Possiveis side effects:** codigo que acidentalmente dependia da precedencia raiz passa a receber o provider local. A mudanca deve ser tratada como correcao comportamental potencialmente breaking.

Criterio de aceite: quando root e subtree fornecem a mesma tag, corpo, handler,
rerender e cleanup observam sempre a instancia local; siblings e o root continuam
isolados.

#### EFFECT-010 - A pipeline de render transforma interrupcao em sucesso ou fallback

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `replace` e `reconcile` capturam `Effect.exit`, aplicam
`Cause.squash` e retornam `FailedBeforeCommit` pelo canal de sucesso em
`packages/core/src/primitives/render-transaction.ts:64-75,115-139`. Callers
reconstroem isso como falha tipada com `Effect.fail(outcome.cause)` em
`packages/core/src/primitives/render-component.ts:334-336` e
`render-signal-element.ts:233-235`. O ErrorBoundary captura qualquer Cause para
montar fallback em `render-error-boundary.ts:170-181` e fecha o Scope interrompido
com `Exit.void` em `render-error-boundary.ts:101-104,170-176`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.3, "Cause Handling" (`MUST NOT`: `catchCause` nao transforma interrupcao ou defect em fallback success acidentalmente), e secao 10.4, "Interruption" (`MUST`: interrupcao permanece observavel atraves de adapters, fibers e cleanup).
2. **Por que falhou:** `Cause.squash` apaga a classificacao fail/die/interrupt e o enum de outcome passa pelo canal de sucesso. Depois, `Effect.fail` fabrica uma falha tipada comum. No boundary, a interrupcao e interpretada como erro renderizavel, produz fallback, `onError` e fechamento com Exit de sucesso.
3. **Possivel solucao:** inspecionar a Cause inteira com `catchCause`/`catchCauseIf`; criar `FailedBeforeCommit` somente quando todos os reasons forem `Fail` e a policy para multiplos failures estiver definida. `Effect.catch`/`catchTags` isolados nao bastam em `rc.112`, pois podem recuperar o primeiro `Fail` de uma Cause que tambem contem `Die` ou `Interrupt`. Nos demais casos, usar `Effect.failCause(cause)`. Um ErrorBoundary pode tratar defects se esse for seu contrato explicito, mas deve preserva-los/reporta-los como defects e fechar cada Scope com o Exit/Cause real.
4. **Ganhos esperados:** cancelamento permanece distinguivel, unmount nao gera UI de erro nem recovery, e finalizers exit-sensitive recebem a razao correta.
5. **Possiveis side effects:** interrupcoes deixam de aparecer como fallback visual. Assinaturas e callers que hoje tratam `unknown` tipado precisarao operar no nivel de Cause para defects e cancelamento.

Criterio de aceite: uma matriz de falha tipada, defect e interrupcao prova que a
falha prevista entra no fallback, defect so entra quando o boundary declara essa
policy e interruption nunca entra; a classificacao e o Exit dos finalizers sao
preservados.

#### EFFECT-011 - O commit pode perder o unico owner do novo subtree

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: depois de renderizar `next`, uma falha em `insertBefore` retorna
`RenderTransactionError` sem executar `next.cleanup` em
`packages/core/src/primitives/render-transaction.ts:78-92`. Depois de um commit
bem-sucedido, `previous.cleanup` ainda pode falhar antes de a funcao devolver o
novo `RenderResult` em `render-transaction.ts:94-107`. O caller transfere
`currentRenderScope` e `currentResult` somente depois desse retorno em
`packages/core/src/primitives/render-component.ts:339-343`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.4, "Resource Acquisition" (`MUST`: recurso adquirido que exige release possui owner estrutural e finalizer), e secao 16.3, "External APIs" (`MUST`: recurso nativo e finalizado mesmo quando uso falha).
2. **Por que falhou:** antes do commit, o novo subtree ja adquiriu DOM, subscriptions e scopes, mas nao esta protegido por bracket. Depois do commit, ele ja e authoritative no DOM, mas ownership ainda pertence a uma funcao que pode falhar limpando o resultado anterior. Em ambos os lados, uma falha deixa recurso sem owner alcancavel.
3. **Possivel solucao:** manter `next` sob `acquireUseRelease` ate commit; limpar `next` e seu Scope se o commit falhar; transferir ownership ao resultado committed antes de cleanup falivel do anterior; representar cleanup posterior como outcome committed com `cleanupCause`, sem fingir que o commit nao ocorreu.
4. **Ganhos esperados:** exatamente um owner permanece responsavel pelo subtree em toda fase e falha de cleanup nao contradiz o estado DOM ja committed.
5. **Possiveis side effects:** o enum de outcome e seus callers mudam. Cleanup failure depois do commit deixa de falhar como se nada tivesse sido aplicado e precisara de observabilidade/recovery especificos.

Criterio de aceite: falha injetada no commit limpa integralmente `next`; falha no
cleanup anterior ainda devolve ownership do novo resultado, que e limpo em um
unmount subsequente.

#### EFFECT-012 - Portal e document mount vazam mutacoes quando a construcao falha

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: `renderPortal` monta children diretamente no target e so constroi o
cleanup depois que todos terminam em
`packages/core/src/primitives/render-portal.ts:48-66`. O document renderer aplica
atributos, registra subscriptions e monta children sequencialmente antes de
retornar cleanup em `packages/core/src/primitives/renderer.ts:297-375`. Se um
child posterior falha, resultados anteriores e atributos ja aplicados ficam sem
um `RenderResult` retornado ao caller.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.4, "Resource Acquisition" (`MUST`: recursos com release possuem owner estrutural e finalizer), e secao 16.3, "External APIs" (`MUST`: recursos nativos sao finalizados mesmo quando uso falha).
2. **Por que falhou:** DOM e subscriptions sao adquiridos progressivamente sem bracket ou undo instalado imediatamente. O cleanup agregado so existe no caminho de sucesso; uma falha no meio abandona tudo que ja foi montado.
3. **Possivel solucao:** registrar undo imediatamente para cada mutacao e executa-lo em ordem reversa com `onError`/`acquireUseRelease`. Para Portal, montar em `DocumentFragment` e anexar somente apos sucesso. Para document elements, restaurar atributos, subscriptions e children se qualquer etapa falhar.
4. **Ganhos esperados:** render com falha preserva o DOM anterior e nao deixa nodes, listeners ou subscriptions sem owner.
5. **Possiveis side effects:** staging muda o momento em que portal children ficam conectados ao document; codigo que depende de connectedness durante construcao precisara de um lifecycle explicito pos-commit.

Criterio de aceite: falha no segundo child deixa target e document identicos ao
estado inicial, remove subscriptions e executa todos os finalizers ja adquiridos.

### Router e navegacao

#### EFFECT-013 - Navegacoes concorrentes publicam estado rasgado e permitem stale overwrite

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `SynchronizedRef` protege somente refresh/read do snapshot em
`packages/core/src/router/navigation-core.ts:108-117`; `adapter.push/replace` e
o commit posterior ficam fora de uma exclusao comum em
`navigation-core.ts:121-130`. Depois, `currentSignal` e `querySignal` duplicam a
mesma verdade e sao publicados sequencialmente por Effects suspensiveis em
`packages/core/src/router/service.ts:898-929,1246-1280`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 11.5, "Idempotency and Concurrent Writes" (`SHOULD`: toda mutacao publica define last-write-wins, optimistic concurrency, serializacao ou admissao idempotente), e secao 12.3, "Single Flight and Locking" (`SHOULD`: o owner esconde a politica de lock/single-flight).
2. **Por que falhou:** nao existe uma unidade linearizada que cubra mutacao do history adapter, snapshot e publicacao. Uma navegacao antiga pode terminar por ultimo e sobrescrever uma mais nova. Mesmo quando `currentSignal` ja aponta para a rota nova, um listener suspensivel permite que a operacao anterior publique sua query depois, formando um estado impossivel entre `Router.current` e `Router.query`.
3. **Possivel solucao:** selecionar explicitamente uma politica, preferencialmente latest-wins versionado; serializar adapter + snapshot em um coordenador; manter um unico `NavigationState` atomico e derivar query; e impedir que versoes supersedidas publiquem signals, trace ou scroll. Nao manter mutex durante listeners reentrantes que podem redirecionar.
4. **Ganhos esperados:** current route, query, history e eventos passam a descrever a mesma navegacao independentemente do escalonamento.
5. **Possiveis side effects:** redirects, `popstate`, back/forward e scroll precisam participar do mesmo protocolo de versao. A ordem de notificacoes e traces muda e pode expor dependencias acidentais de interleavings antigos.

Criterio de aceite: testes com `Deferred` controlam tanto uma primeira mutacao
de adapter lenta quanto um listener lento; ao final, todas as Fibers terminam e
history, route, query e versao correspondem unicamente a navegacao vencedora.

#### EFFECT-014 - Ativacao stale nao e interrompida e pode trocar DOM ou aplicar scroll

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `commitAfterDomSwap` verifica freshness antes e depois de `swap`, mas
o DOM ja foi alterado quando o segundo check descobre staleness em
`packages/core/src/router/route-activation.ts:204-227`; `afterSwap` nao e
protegido durante sua execucao. `showLoadingFallback` possui o mesmo check-then-act
em `route-activation.ts:191-202`. O Outlet permite que um unico
`requestAnimationFrame` venca o `Deferred` real em
`packages/core/src/router/outlet.ts:705-757`, embora o proprio comentario reconheca
que um frame nao comprova o commit. O `ScrollIntent` e descartado ao criar requests
em `outlet.ts:1170-1178,1311-1316`, enquanto a coordenacao mantem apenas um slot
global em `navigation-outlet-coordination.ts:45-77`. A opcao
`interruptStaleLoads` somente consulta staleness depois que `loadComponent`
termina em `route-activation.ts:363-395`; seu teste usa loader imediato e apenas
confirma descarte tardio em
`packages/core/src/router/__tests__/route-activation.test.ts:349-377`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.4, "Interruption" (`MUST`: interrupcao/cancelamento permanece observavel), secao 12.1, "Structured Ownership" (`MUST`: owner consegue interromper e aguardar trabalho superseded), e secao 21.6, "Unsupported Adapter Behavior" (`MUST NOT`: enfraquecer ordering ou cancellation). O contrato local de `route-activation.ts:4-8` tambem promete impedir commit visivel stale.
2. **Por que falhou:** activation ID e consultado ao redor da mutacao, nao participa dela. Uma versao pode ficar stale durante load, `swap` ou `afterSwap`; o outcome diz `DroppedStale` depois que loader, DOM ou scroll ja produziram efeitos. Scroll usa estado global mutavel e pode consumir a intent de outra navegacao. Chaves baseadas apenas no mesmo milissegundo em `navigation-core.ts:121-129` ainda podem colidir.
3. **Possivel solucao:** carregar ID unico e `ScrollIntent` no snapshot/activation; tornar o commit token-aware ou interromper e aguardar a ativacao anterior antes do swap; validar o token durante scroll; usar `intent.scrollKey`, nao estado global; gerar identidade monotona/aleatoria; e usar fallback de frame somente quando for comprovado que `Signal.set` deduplicou e nao havera swap.
4. **Ganhos esperados:** rota superseded nao se torna visivel, nao move a pagina e nao emite commit; hash e restauracao permanecem ligados a history entry correta.
5. **Possiveis side effects:** imports dinamicos nativamente nao abortaveis podem terminar em background, embora seus resultados sejam descartados; efeitos stale passam a receber interrupcao; formato/identidade de chaves de scroll muda.

Criterio de aceite: loaders, loading fallback, swap e scroll bloqueados por
`Deferred` provam interrupcao/finalizacao da activation superseded; somente a
activation atual altera DOM, consome sua propria intent e emite terminal commit.

#### EFFECT-015 - O Outlet mantem um segundo matcher que diverge do contrato canonico

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: o matcher canonico compila patterns e usa
`matchCompiledRoutePathPattern` em
`packages/core/src/router/path-pattern.ts:98-192` e
`packages/core/src/router/matching.ts:273-310`. O Outlet implementa um trie
independente em `packages/core/src/router/outlet.ts:126-269`. Cada aresta dinamica
armazena somente o nome do primeiro parametro em `outlet.ts:143-156,204-220`, e
a compilacao interrompe o pattern depois de wildcard/catch-all em
`outlet.ts:148-157`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 7.2, "Canonical Representations" (`SHOULD`: uma representacao possui um Schema e caminho canonico; `MUST NOT`: condicionais ad hoc criam uma segunda representacao concorrente), e secao 19.3, "Adapter Conformance" (`SHOULD`: implementacoes do mesmo contrato executam os mesmos casos publicos).
2. **Por que falhou:** rotas que compartilham a mesma posicao dinamica tambem compartilham o nome capturado pela primeira. Assim, `/users/:slug/view` pode ser selecionada com params `{ id: ... }` por causa de `/users/:id/edit`, e sua Schema falha apenas no Outlet real. Catch-all com sufixo tambem e aceito/rejeitado de forma diferente pelos dois algoritmos.
3. **Possivel solucao:** possuir um unico matcher. Se o trie for necessario por desempenho, guardar valores por posicao e materializar nomes pelo `CompiledRoutePathPattern` da rota escolhida; definir catch-all como terminal ou implementar sufixos igualmente nos dois caminhos.
4. **Ganhos esperados:** params, Schemas, tooling e Outlet deixam de depender da ordem de declaracao e passam a concordar para todo pattern.
5. **Possiveis side effects:** patterns catch-all atualmente aceitos por acidente podem passar a falhar na compilacao; qualquer otimizacao do trie precisara preservar a suite de conformance canonica.

Criterio de aceite: os mesmos casos parametrizados rodam contra matcher linear e
trie, cobrindo nomes diferentes no mesmo prefixo, wildcard, catch-all obrigatorio,
sufixos e patterns invalidos, sempre com rota e params identicos.

### Observabilidade

#### EFFECT-016 - Trace HTTP inclui a query completa no evento de request

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: os adapters backend Node e Bun emitem `req.url` integral no evento
`api.request.received` em
`packages/core/src/vite/dev-platform-node.ts:179-183` e
`packages/core/src/vite/dev-platform-bun.ts:309-313`. Esse valor inclui a query e
segue pelo pipeline normal de logging de `Trace.emit` em
`packages/core/src/trace/trace.ts:70-76`. Signals, Resource e Router tambem
transportam valores genericos/Causes no browser, mas essa superficie e apenas
hardening extrarrfc e nao sustenta a classificacao normativa deste achado.

1. **Referencia falha do RFC:** secao 17.4, "Sampling and Cardinality" (`MUST NOT`: query-bearing URLs e raw Causes entram em routine operation events), secao 16.2, "Secrets" (`MUST NOT`: secrets aparecem em eventos, logs, spans, metricas ou erros para callers nao confiaveis), e secao 27.4, "Secret and Data Exposure" (`MUST NOT`: credenciais, authorization data, file content e secret-bearing config sao emitidos ou snapshotados).
2. **Por que falhou:** query strings podem conter token, codigo de autorizacao ou dado pessoal. Registrar a URL de request sem sanitizacao envia esse material a qualquer logger/Debug configurado no servidor.
3. **Possivel solucao:** parsear a URL no adapter e registrar somente pathname ou route template, nomes/quantidade de query keys e campos permitidos por evento. Aplicar redactor central apenas como defesa adicional.
4. **Ganhos esperados:** remove query secrets de console, recorder e exportadores sem perder metodo, rota e dimensoes operacionais seguras.
5. **Possiveis side effects:** diagnosticos deixam de mostrar a query diretamente; snapshots e analyzers do evento precisam migrar. Hashes tambem devem ser evitados quando criam identificador correlacionavel desnecessario.

Criterio de aceite: valores sentinela secretos colocados na query de requests API
Node e Bun nao aparecem em recorder, Debug ou exportador, enquanto metodo e
pathname continuam presentes.

#### EFFECT-017 - Falha da instrumentacao pode interromper uma mutacao ja commitada

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `Trace.emit` avalia o thunk e executa o logger sem containment em
`packages/core/src/trace/trace.ts:70-76`. `Signal.set` altera a celula antes de
emitir e somente depois atualiza metrica e listeners em
`packages/core/src/primitives/signal.ts:687-708`. Um throw no payload ou logger
faz o caller receber defect depois que o estado ja mudou, sem notificar os
consumidores. Resource ainda possui catches que podem tentar emitir novamente em
`packages/core/src/primitives/resource.ts:584-629`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 17.3, "Emission and Failure" (`MUST NOT`: falha de telemetria altera resultado de negocio commitado), e secao 21.5, "Observability Context" (`MUST NOT`: observabilidade adiciona falhas ao canal de negocio).
2. **Por que falhou:** payload e logger fazem parte da sequencia principal e nao ha isolamento da origem da falha. Quando a emissao ocorre depois da mutacao, a API reporta Failure embora o valor authoritative ja tenha sido alterado; listener e metricas permanecem atrasados. Em recovery instrumentado, uma falha do logger ainda pode duplicar eventos parcialmente observados.
3. **Possivel solucao:** suspender e proteger tanto a construcao do payload quanto a emissao; distinguir falha da instrumentacao da interrupcao da operacao e sempre reemitir esta ultima; usar um fallback minimo independente, limitado e tambem protegido.
4. **Ganhos esperados:** estado commitado nunca parece rollback por causa do logger e listeners/metricas continuam consistentes com a mutacao.
5. **Possiveis side effects:** um logger defeituoso deixa de derrubar a aplicacao e pode ficar menos visivel; o fallback precisa evitar loop e flood e ainda sinalizar perda de observabilidade.

Criterio de aceite: payload e logger hostis, antes e depois de uma mutacao,
preservam resultado, listener e metrica; interrupcao real continua observavel e
nenhum evento e duplicado.

#### EFFECT-018 - Habilitar Trace muda a execucao de `Signal.derive`

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: a funcao de derivacao `f(initial)` cria o Signal em
`packages/core/src/primitives/signal.ts:1067-1069` e e executada novamente apenas
para o payload de `signal.derive.create` em `signal.ts:1070-1074`. Esse segundo
thunk so e avaliado quando o nivel/logger habilita o evento.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 17.3, "Emission and Failure" (`MUST NOT`: telemetria altera um resultado de negocio bem-sucedido).
2. **Por que falhou:** instrumentacao reexecuta logica de aplicacao. Uma derivacao impura pode produzir side effect duas vezes, gravar no payload valor diferente do Signal ou lancar somente quando Trace esta ativo. Portanto, log level altera semantica e Exit do programa.
3. **Possivel solucao:** calcular `const initialValue = f(initial)` exatamente uma vez e reutiliza-lo em `makeOwnedSignal` e no payload.
4. **Ganhos esperados:** derivacao possui o mesmo valor, side effects e Exit com Trace ligado, filtrado ou ausente; o evento descreve o estado realmente armazenado.
5. **Possiveis side effects:** somente codigo que dependia acidentalmente da segunda invocacao deixa de observa-la.

Criterio de aceite: uma funcao com contador e outra que lanca na segunda chamada
sao executadas com recorder ativo/inativo e em ambos os casos `f` roda uma vez.

#### EFFECT-019 - Nome do evento e tipado, mas fatos e origem do Trace nao sao

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `TraceRecord.payload` e `TracePayload` usam
`Record<string, unknown>` em `packages/core/src/trace/trace.ts:36-42`; `emit` nao
relaciona nome a payload em `trace.ts:70-76`; e o catalogo descreve somente
family/level/summary em `packages/core/src/trace/catalog.ts:52-77`. `recordOf`
aceita qualquer log cujo primeiro texto coincida com um nome do catalogo em
`trace.ts:129-160`, inclusive `Effect.log("signal.set")` que nunca passou por
`Trace.emit`.

1. **Referencia falha do RFC:** secao 17.2, "Typed Facts" (`SHOULD`: modulos contribuem fatos tipados pelo seu vocabulario; `SHOULD NOT`: `Record<string, unknown>` irrestrito e a interface de fatos de producao).
2. **Por que falhou:** somente a string do evento e fechada; campos ausentes, extras, sensiveis ou de tipo errado compilam. Como nao ha marca de origem, logs de aplicacao podem ser reconstruidos como eventos oficiais e alimentar recorder, budgets e analyzers.
3. **Possivel solucao:** criar mapa `TraceEventName -> Payload` com Schemas/JSON representations e tornar `emit` generico sobre esse mapa; adicionar uma annotation privada de origem que somente `Trace.emit` grava e `recordOf` exige.
4. **Ganhos esperados:** payload incorreto falha no typecheck/decode, redacao passa a ser revisavel por evento e logs comuns nao falsificam contratos do framework.
5. **Possiveis side effects:** todos os callsites e helpers genericos precisam migrar; logs antigos que usavam casualmente nomes do catalogo deixam de aparecer no Trace, que e a semantica correta.

Criterio de aceite: type tests rejeitam campos ausentes/extras e tipos errados;
runtime rejeita um `Effect.log` homonimo e aceita somente evento marcado e decodado.

#### EFFECT-020 - `Trace.withAction` pode emitir start sem terminal e chama interrupcao de falha

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `Trace.withAction` emite start, aguarda `Effect.exit` e somente depois
emite end em `packages/core/src/trace/trace.ts:83-107`. Interrupcao externa antes
da continuacao impede o terminal; interrupcao explicita vira Exit failure e e
emitida como `status: "failed"` com `Cause.pretty`.

1. **Referencia falha do RFC:** secao 17.1, "Canonical Event" (`SHOULD`: um lifecycle comparavel emite um evento context-rich), e secao 17.4 (`SHOULD`: sampling retem interrupcoes e routine events nao incluem raw Causes).
2. **Por que falhou:** o terminal nao esta em `onExit`/finalizer, portanto cancelamento externo abandona lifecycle aberto. Quando a interrupcao chega pelo proprio Effect, a Cause ainda e reemitida corretamente, mas o contrato de telemetria a reduz ao mesmo status de falha e inclui seus detalhes.
3. **Possivel solucao:** emitir terminal protegido via `onExit`/finalizer, usar union `completed | failed | interrupted`, registrar somente tags seguras e relancar a Cause original depois da observacao.
4. **Ganhos esperados:** todo action possui exatamente um terminal e cancelamento pode ser consultado, retido e operado separadamente de falha.
5. **Possiveis side effects:** cancelamento espera uma pequena finalizacao; schemas, snapshots e analyzers precisam aceitar o novo status.

Criterio de aceite: interrupcao externa coordenada e `Effect.interrupt` explicito
produzem exatamente um terminal `interrupted`, sem Cause serializada, e preservam
o Exit original.

#### EFFECT-021 - Recorder preserva referencias mutaveis e nao garante JSON serializavel

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `recordOf` retorna a mesma referencia de payload em
`packages/core/src/trace/trace.ts:150-160`; `makeRecorder` armazena esse objeto sem
encode/copia em `trace.ts:178-190`; `toJSON` devolve novamente a referencia em
`packages/core/src/trace/report.ts:47-64`. Objetos ciclicos e BigInt quebram
`JSON.stringify(toJSON(...))`; getters ou `toJSON` hostis ainda podem quebrar a
renderizacao de report.

1. **Referencia falha do RFC:** secao 17.2, "Typed Facts" (`SHOULD`: fatos possuem vocabulario tipado), e secao 19.4, "Intent and Interaction" (fato observado pode ser contrato publico de teste).
2. **Por que falhou:** recorder nao estabelece uma representacao detached e JSON-safe no boundary. Mutar o objeto depois de `emit` reescreve o historico, e a API chamada `toJSON` nao entrega necessariamente algo que JSON consiga serializar.
3. **Possivel solucao:** no momento da gravacao, codificar o payload pelo Schema do evento para uma representacao JSON-safe imutavel; fazer reports consumirem apenas essa forma e conter getters/hooks hostis.
4. **Ganhos esperados:** snapshots deterministas, historico temporal imutavel e artefatos JSON/Markdown confiaveis.
5. **Possiveis side effects:** ha custo de encode/copia quando recorder esta ativo; funcoes, Symbols, ciclos e tipos especiais precisam de representacao explicita e potencialmente lossy.

Criterio de aceite: mutacao posterior nao altera records; ciclos, BigInt e hooks
hostis produzem a representacao/falha tipada documentada; `JSON.stringify` do
resultado nunca surpreende.

#### EFFECT-022 - `Debug.layer` preserva outro Debug e duplica eventos/filtros

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `Debug.layer` remove somente `Logger.defaultLogger` e preserva todos
os outros loggers antes de adicionar o seu em
`packages/core/src/debug/debug.ts:290-323`. O entry gerado instala
`Debug.consoleLogger`; um `Debug.layer({ filter: "signal" })` interno adiciona
outro logger, de modo que o logger externo continua imprimindo eventos rejeitados
pelo filtro local.

1. **Referencia falha do RFC:** secao 17.1, "Canonical Event" (`SHOULD`: registrar o lifecycle, nao narrar em linhas duplicadas), e secao 17.5, "Annotation and Logging" (`SHOULD`: recovery permanece observavel sem duplicar o mesmo erro em cada layer).
2. **Por que falhou:** loggers Debug nao possuem identidade separada de recorders/tracers. A composicao anunciada como configuracao scoped e aditiva inclusive para o proprio console logger; um evento e impresso duas vezes e o filtro local nao restringe a saida total.
3. **Possivel solucao:** marcar loggers pertencentes a Debug e substituir somente o Debug ambiente mais proximo, preservando recorders, tracing e loggers nao-Debug.
4. **Ganhos esperados:** uma linha por evento e filtros/batching realmente aplicados ao subtree sem remover observadores independentes.
5. **Possiveis side effects:** duas camadas Debug deliberadamente aditivas passam a ter semantica de override; documentar essa composicao.

Criterio de aceite: root Debug mais Layer interno produz uma unica linha; evento
fora do filtro nao escapa pelo root; recorder paralelo continua recebendo o fato.

### Resource e cache local

#### EFFECT-023 - O signal compartilhado do cache pertence ao primeiro componente consumidor

Severidade: **Critica**. Classe: **recomendacao extrarrfc**.

Evidencias: `ResourceRegistryLive.getOrCreate` chama `Signal.make` antes de criar
o Scope da entrada em `packages/core/src/primitives/resource.ts:476-503`.
`Signal.make` prefere `CurrentComponentScope` e ainda participa da identidade por
posicao de `CurrentRenderPhase` em
`packages/core/src/primitives/signal.ts:476-498,545-577`. O registry captura seu
proprio Scope em `resource.ts:466-471`, mas nao o fornece nem neutraliza os
References do caller ao construir o signal.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 9.3, "Placement and Sharing" (`SHOULD`: placement considera identidade, lifetime e isolamento), secao 12.4, "Resource Acquisition" (`MUST`: recurso com release possui owner estrutural), e secao 15.3, "Failure and Consistency" (`SHOULD`: cache revisa lifecycle e invalidation).
2. **Por que falhou:** metodos de Service executam no Context do caller. A primeira chamada feita durante render coloca o signal global da entrada nos slots e Scope daquele Component. Desmontar o primeiro consumidor dispoe o signal, mas a entrada continua no Map e e devolvida a outros componentes como cache compartilhado morto.
3. **Possivel solucao:** criar primeiro `entry.scope` e construir o signal explicitamente nesse owner, neutralizando `CurrentRenderPhase` e `CurrentComponentScope`. Preferir um construtor interno de Signal que receba owner e Scope a depender de References ambientais.
4. **Ganhos esperados:** elimina corrupcao de slots, disposal prematuro, cache morto e compartilhamento acidental de lifetime entre componentes/providers.
5. **Possiveis side effects:** `Resource.clear` passa a dispor corretamente o signal da entrada; referencias conservadas depois de clear observarao a semantica ja documentada de signal disposto.

Criterio de aceite: dois componentes usam a mesma chave; rerender e unmount do
primeiro nao dispoem nem removem atualizacoes do segundo, e nenhum evento
`signal.disposed_access` ocorre.

#### EFFECT-024 - `Resource.hash` usa um hash de 32 bits como identidade unica

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: a API documenta chave "collision-resistant", mas retorna diretamente
`Hash.combine(Hash.structure(params))` em
`packages/core/src/primitives/resource.ts:345-370`. O registry usa essa string
como chave unica do Map. Na versao instalada, hash estrutural nao prova igualdade;
por exemplo `{ id: 1, page: 2 }` e `{ id: 0, page: 3 }` produziram a mesma chave
para o mesmo prefixo.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 15.3, "Failure and Consistency" (`SHOULD`: revisar keys, invalidation e consistency), e secao 23.4, "Cache Stability" (`SHOULD`: preservar isolamento e estabilidade).
2. **Por que falhou:** hash numerico foi confundido com identidade. Colisao faz recursos distintos compartilhar Signal, resultado, failure, in-flight e invalidation sem comparar os parametros originais.
3. **Possivel solucao:** usar codificacao canonica, ordenada e type-tagged dos parametros como identidade completa. Se chave curta for necessaria, usar buckets e confirmar igualdade da representacao original; hash isolado nunca decide identidade.
4. **Ganhos esperados:** recursos distintos nao compartilham cache nem I/O e todas as dimensoes de identidade permanecem verificaveis.
5. **Possiveis side effects:** strings de chave e traces mudam; o cache em memoria inicia frio apos upgrade e integracoes que inspecionam keys precisam migrar.

Criterio de aceite: property/collision tests cobrem ordem, ausencia versus
`undefined`, numeros especiais, delimitadores e versao; somente
representacoes realmente iguais compartilham entrada.

#### EFFECT-025 - O claim single-flight e uma sequencia read-then-set nao atomica

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: callers leem `entry.inFlight` em
`packages/core/src/primitives/resource.ts:737-766,858-875,1297-1311,1343-1355`;
somente depois `fetchInternal` cria e grava outro `Deferred` em
`resource.ts:568-570`. Duas Fibers podem observar `None`, iniciar dois fetches e
cada finalizer pode limpar refs pertencentes a outra execucao.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2, "Primitive Selection" (Ref representa estado atomico), secao 12.3, "Single Flight and Locking" (`SHOULD`: claim/Deferred e politica de join permanecem internos ao owner), e secao 15.3 (`SHOULD`: revisar single flight e stampede).
2. **Por que falhou:** `Ref` e atomico por operacao, nao por uma sequencia de get seguido de set. Sob yield entre ambos, duas operacoes se declaram owners do mesmo trabalho e quebram deduplicacao e settlement.
3. **Possivel solucao:** criar um `Deferred` candidato e usar `Ref.modify` para decidir atomicamente `Start(candidate)` ou `Join(existing)`; limpar somente com compare-and-set da mesma identidade. Centralizar fetch, refresh, invalidate e reactive fetch nesse helper.
4. **Ganhos esperados:** exatamente um I/O por chave, sem stampede, estado in-flight prematuramente limpo ou waiters presos no Deferred errado.
5. **Possiveis side effects:** a politica deve definir que interrupcao de waiter nao cancela automaticamente o trabalho compartilhado; o claim nunca deve ficar retido durante I/O externo.

Criterio de aceite: chamadas realmente paralelas por todos os entrypoints iniciam
um fetch, compartilham settlement e deixam refs vazias somente depois do owner
correto terminar.

#### EFFECT-026 - Cada rerender acumula subscriptions e daemons de `fetchReactive`

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `fetchReactive` usa `Effect.scope` em
`packages/core/src/primitives/resource.ts:784-786` e registra subscriptions,
daemon e finalizers nesse Scope em `resource.ts:844-938`. Dentro de Component,
esse Scope e o `componentScope` fornecido em
`packages/core/src/primitives/render-component.ts:193-211`; o
`Signal.CurrentRenderScope`, fechado a cada render substituido, nao e usado.
`outputState` e reutilizado por posicao, mas listeners e refs sao recriados.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.1, "Structured Ownership" (`MUST`: trabalho concorrente termina com seu owner), secao 15.3 (`SHOULD`: revisar lifecycle) e secao 23.2, "Backpressure and Memory" (`SHOULD`: limitar crescimento de buffers/caches/trabalho concorrente).
2. **Por que falhou:** estado que deve durar o Component e maquinaria pertencente a uma render pass recebem o mesmo owner longo. Cada rerender adiciona outro listener e daemon ate o unmount total, produzindo notificacoes e fetch decisions duplicadas.
3. **Possivel solucao:** manter apenas o output Signal no component Scope; instalar subscriptions, active refs e daemon no `CurrentRenderScope` quando existir, com fallback ao Scope normal fora do Renderer.
4. **Ganhos esperados:** numero constante de listeners, uma reacao por alteracao e cleanup imediato de renders substituidos ou falhos.
5. **Possiveis side effects:** durante troca de render scopes pode haver curta sobreposicao; o claim atomico do EFFECT-025 deve tornar essa janela segura.

Criterio de aceite: muitos rerenders nao relacionados mantem um listener/daemon,
uma mudanca de param dispara uma reacao e unmount deixa zero trabalho ativo.

#### EFFECT-027 - Resource converte defects e Causes mistos em `Failure<E>`

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `fetchInternal` usa `matchCauseEffect`, descarta apenas interrupcao
pura e aplica `Cause.squash` mais cast para `E` em
`packages/core/src/primitives/resource.ts:584-630`. Um descriptor com `E = never`
e `Effect.die("boom")` ainda publica `ResourceState.Failure` com `"boom"`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.2, "Defects" (`SHOULD NOT`: falha operacional esperada vira die e bugs podem permanecer defects), secao 10.3, "Cause Handling" (`MUST`: recovery de negocio opera no canal tipado; `MUST NOT`: Cause handling transforma defect/interrupcao em fallback comum), e secao 10.4 (`MUST`: interrupcao permanece observavel).
2. **Por que falhou:** `Cause.squash` e lossy e o cast fabrica um valor de `E` sem prova. Bugs, interrupcoes parciais e failures compostas ficam indistinguiveis de erro operacional esperado e podem ser recuperados por UI como se o tipo os admitisse.
3. **Possivel solucao:** inspecionar todos os `cause.reasons` e construir `Failure<E>` somente quando cada reason for `Cause.isFailReason`; definir explicitamente como multiplos `Fail` viram um unico estado ou preservar a colecao. Qualquer `Die`/`Interrupt` reemite a Cause integral ao supervisor/owner do registry, sem cast.
4. **Ganhos esperados:** `E` volta a ser verdadeiro, bugs chegam ao ErrorBoundary/operacao apropriada e cancelamento nao vira estado recuperavel falso.
5. **Possiveis side effects:** defects deixam de aparecer no handler comum de Resource Failure; definir se o Signal permanece Pending ou ganha estado interno terminal enquanto o owner reporta o defect.

Criterio de aceite: `Effect.fail`, `Effect.die`, interrupcao pura e Cause mista
produzem canais/outcomes distintos verificados por Exit e Cause.

#### EFFECT-028 - O registry nao possui capacidade, TTL ou eviction

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `ResourceRegistryLive` mantem um unico `Map` em
`packages/core/src/primitives/resource.ts:466-535`; cada chave conserva Signal,
Refs e Scope ate `clear` ou shutdown. `timestamp` e criado e atualizado em
`resource.ts:385,500,636-640`, mas nunca e consultado.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 15.3 (`SHOULD`: cache revisa capacity, expiration, invalidation e lifecycle), secao 23.2 (`SHOULD`: cache sem bound exige argumento externo seguro), secao 23.4 (`SHOULD`: politicas limitam capacidade/lifetime), e secao 27.5 (`SHOULD`: verificar bounds contra denial of service).
2. **Por que falhou:** nao ha argumento de conjunto finito nem politica de capacidade, TTL ou idle expiration. Churn de IDs controlados por input cresce memoria e scopes durante toda a aplicacao.
3. **Possivel solucao:** tornar policy parametro do Layer, com capacidade, lifetime e comportamento de eviction; ou documentar e testar um bound externo concreto. Fechar scopes evicted fora do lock global.
4. **Ganhos esperados:** memoria previsivel e resistencia a churn de keys sem exigir clear manual em toda feature.
5. **Possiveis side effects:** eviction pode interromper fetches e dispor Signals ainda referenciados; policy deve definir leases/entries ativas e isolamento por tenant.

Criterio de aceite: TestClock e entradas controladas provam limite, expiracao,
eviction in-flight, cleanup uma vez e recriacao correta.

#### EFFECT-029 - `clear` fecha Scope enquanto segura o lock global do cache

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `deleteEntry` executa `Scope.close(entry.scope)` dentro de
`SynchronizedRef.modifyEffect` sobre o Map inteiro em
`packages/core/src/primitives/resource.ts:512-526`. Qualquer finalizer lento de
uma chave mantem a exclusao usada por todas as outras.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2, "Primitive Selection" (a primitive determina exclusion e overload), secao 12.3 (`SHOULD`: locks permanecem internos e protegem apenas a decisao necessaria), e secao 27.5 (`SHOULD`: bounds/cancellation protegem contra indisponibilidade).
2. **Por que falhou:** uma mutacao curta de Map e uma finalizacao arbitrariamente longa compartilham a mesma critical section. Clear de A bloqueia get/create/clear de B e um finalizer travado paralisa todo o Resource registry.
3. **Possivel solucao:** remover e retornar a entrada atomicamente, liberar o lock e somente depois fechar seu Scope. Definir a remocao como ponto de linearizacao.
4. **Ganhos esperados:** chaves independentes nao sofrem head-of-line blocking e finalizacao lenta nao indisponibiliza o cache.
5. **Possiveis side effects:** a mesma chave pode ser recriada enquanto o Scope antigo termina; essa coexistencia transitoria deve ser suportada e testada.

Criterio de aceite: finalizer de A bloqueado nao impede operacoes em B; A pode ser
recriada conforme a policy e cada Scope antigo fecha exatamente uma vez.

### Seguranca e contratos de dados

#### EFFECT-030 - `SafeUrl` aceita formas canonicas de `javascript:`

Severidade: **Critica**. Classe: **recomendacao extrarrfc**.

Evidencias: `extractScheme` usa regex ASCII case-sensitive ancorada no primeiro
caractere em `packages/core/src/security/safe-url.ts:168-176`; quando nao encontra
scheme, `validateSyncWithConfig` considera a URL relativa e segura em
`safe-url.ts:199-219`. O renderer aplica o valor aceito diretamente em
`packages/core/src/primitives/render-utils.ts:156-163`. Variantes como
`JAVASCRIPT:`, whitespace/tab inicial e `java\nscript:` sao normalizadas pelo
parser WHATWG para protocolo `javascript:`, mas passam pelo detector atual.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 7.1, "Boundary Decoding" (`MUST`: input nao confiavel e decodificado antes do uso), secao 21.1, "Invalid Input or Stored Data" (`MUST NOT`: input invalido e aceito ou reparado silenciosamente), e secao 27.1, "Input and Authorization" (`MUST`: todo input nao confiavel e decodificado antes do uso).
2. **Por que falhou:** a policy decide antes da representacao canonica que o browser executara. Ausencia de match na regex e interpretada como URL relativa, embora case folding, whitespace e controles removidos pelo parser revelem um scheme ativo.
3. **Possivel solucao:** parsear pela URL WHATWG com base explicita para relativos, aplicar allowlist ao `protocol` normalizado e retornar a representacao canonica aprovada. Tratar falha de parse e controles ambiguos como rejeicao.
4. **Ganhos esperados:** fecha bypass direto de XSS e faz validator e browser concordarem sobre a autoridade do scheme.
5. **Possiveis side effects:** entradas anteriormente toleradas por caixa/whitespace passam a ser rejeitadas ou canonicalizadas; snapshots de URL bloqueada mudam.

Criterio de aceite: tabela hostil com caixa, whitespace ASCII, CR/LF/tab,
controles e percent encoding nunca aprova uma URL que WHATWG classifica com
protocolo fora da allowlist.

#### EFFECT-031 - Uma allowlist global de URL e aplicada a sinks com riscos diferentes

Severidade: **Critica**. Classe: **recomendacao extrarrfc**.

Evidencias: `DEFAULT_ALLOWED_SCHEMES` permite `blob:` e `data:` para toda URL em
`packages/core/src/security/safe-url.ts:60-91`; `applyPropValue` valida apenas
chaves literais `href` e `src` em
`packages/core/src/primitives/render-utils.ts:111-176`. A superficie JSX tambem
expoe `formAction`, `action` e `srcSet` em
`packages/core/src/primitives/element.ts:395-410,476-479`, que caem no caminho
generico sem policy.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 7.2, "Canonical Representations" (`MUST NOT`: condicionais ad hoc criam contratos concorrentes), secao 21.1 (`MUST`: input invalido produz falha de boundary), e secoes 27.1-27.2 (`MUST`: input nao confiavel e validado no boundary e nao e concatenado/aplicado a sink executavel inseguro).
2. **Por que falhou:** seguranca de URL depende de elemento e atributo. `data:` pode ser apropriado para algumas imagens e ativo para script; `form[action]`, `button[formAction]` e cada candidato de `srcSet` possuem grammars/protocolos proprios. A regra global deixa sinks sem validacao e permite schemes ativos onde nao sao seguros.
3. **Possivel solucao:** definir policy por elemento/atributo; usar allowlists restritas para navegacao, form submission, script/media e image; analisar cada candidato de `srcSet`; permitir `data:`/`blob:` apenas nos sinks explicitamente aprovados.
4. **Ganhos esperados:** impede execucao ou navegacao ativa por props JSX e torna a policy revisavel no owner correto.
5. **Possiveis side effects:** imagens e blobs legitimos podem precisar de opt-in por sink; tipos/erros do renderer e docs de configuracao mudam.

Criterio de aceite: matriz elemento x atributo x scheme cobre `href`, `src`,
`action`, `formAction` e `srcSet`; nenhum sink ativo aceita scheme que sua policy
nao autoriza.

#### EFFECT-032 - Params de rota nao possuem codec URI de ida e volta

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: interpolacao converte o valor em string, divide por `/` e concatena
sem encode em `packages/core/src/router/path-pattern.ts:270-307`; matching separa
segmentos e devolve o texto percent-encoded sem decode em
`path-pattern.ts:62-68,148-192`. Esse caminho alimenta navegacao em
`packages/core/src/router/navigation-core.ts:81-94`. Valores como `a/b`,
`x?role=admin`, `x#panel` e `../admin` mudam segmentos, query, fragment ou path
canonico.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 7.1 (`MUST`: dado transportado e decodificado antes de dominio), secao 18.1, "Authoritative Inputs" (`MUST`: identidade possui uma localizacao authoritative), e secao 21.1 (`MUST`: invalid input produz typed boundary failure).
2. **Por que falhou:** a API aceita valores de dominio, mas os trata como fragmentos URI prontos. Interpolar e match nao sao transformacoes inversas; caracteres reservados alteram outra autoridade do URL, e `%2F` chega ao dominio ainda encoded.
3. **Possivel solucao:** codificar params simples com `encodeURIComponent`; rejeitar `.`/`..`; em wildcard/catch-all preservar somente barras estruturais e codificar cada segmento; decodificar exatamente uma vez antes de Schema; mapear percent encoding invalido para erro tipado.
4. **Ganhos esperados:** Link, navigate, browser e test adapter preservam identidade para reservados, Unicode e `%`, sem injecao de query/fragment/path traversal semantico.
5. **Possiveis side effects:** callers que passam valores pre-encoded precisam migrar para valores de dominio; slash intencional passa a exigir wildcard/catch-all e a serializacao muda.

Criterio de aceite: property round-trip cobre `/`, `?`, `#`, `%`, Unicode,
`.`/`..` e encoding malformado; o valor decodificado pela Schema e exatamente o
valor interpolado.

#### EFFECT-033 - O output decodificado da Schema de params e convertido de volta para string

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `decodeRouteParams` preserva o output da Schema em
`packages/core/src/router/matching.ts:560-579`, mas `toRouteParams` aplica
`String(value)` em `packages/core/src/router/outlet-services.ts:67-80`. Depois,
`Router.params` apenas narrowing o FiberRef em
`packages/core/src/router/service.ts:547-565`. Com `Schema.NumberFromString`, o
decode produz `42`, enquanto o componente recebe `"42"` apesar do tipo gerado
declarar number.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 7.1 (`MUST`: boundary decoding ocorre antes do uso de dominio), secao 7.2 (`SHOULD`: uma transformacao canonica; `MUST NOT`: segunda representacao concorrente), e secao 21.1 (`MUST NOT`: dado e reparado/reescrito sem semantica da Schema).
2. **Por que falhou:** uma transformacao global posterior apaga a transformacao que a Schema possui. O tipo publico descreve o output decodificado, mas runtime devolve outra representacao sem validacao.
3. **Possivel solucao:** armazenar o objeto decodificado integralmente em `CurrentRouteParams`; manter separada a representacao raw usada pelo matcher; carregar a identidade do pattern ativo e validar o argumento de `Router.params` antes do narrowing.
4. **Ganhos esperados:** runtime e tipo obedecem a Schema, incluindo numbers, brands, dates e transforms, e callers nao recebem falso type safety.
5. **Possiveis side effects:** consumidores que dependiam de string depois de declarar transform passam a receber o tipo documentado; FiberRef e aliases de `RouteParams` precisam ampliar a representacao.

Criterio de aceite: Schemas transformadoras sao observadas por um Component real
com o tipo runtime correto; pedir params de outro pattern falha explicitamente.

#### EFFECT-034 - Middleware reduz defect/interrupcao a resultado ordinario e perde a Cause

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `runMiddlewareChain` aplica `matchCauseEffect` a qualquer Cause e
retorna `MiddlewareResult.Error` pelo canal de sucesso em
`packages/core/src/router/route.ts:881-945`; esse payload e carregado como
`unknown` em `packages/core/src/router/route-activation.ts:500-530`; o Outlet
embrulha novamente o valor em `Cause.fail` em
`packages/core/src/router/outlet.ts:1230-1233`. A classificacao original Die ou
Interrupt deixa de existir.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.2, "Defects" (bugs podem permanecer defects), secao 10.3 (`MUST`: recovery de negocio opera no canal tipado; `MUST NOT`: Cause handling transforma defect/interrupcao em fallback success), e secao 10.4 (`MUST`: interrupcao permanece observavel).
2. **Por que falhou:** o enum coloca toda Cause no caminho de sucesso e tipa seu campo como unknown. Reembrulhar a Cause como failure faz o boundary enxergar uma falha cujo valor e o objeto Cause, nao a Cause original; recovery nao consegue distinguir typed failure, defect e cancelamento.
3. **Possivel solucao:** manter `Cause.Cause<unknown>` integral no resultado somente para o boundary deliberadamente responsavel; reemitir interrupcao; traduzir Redirect/Forbidden pelo canal tipado; documentar se ErrorBoundary captura defects e passa-los diretamente sem `Cause.fail(cause)`.
4. **Ganhos esperados:** cancelamento nao renderiza fallback comum e defects continuam diagnosticaveis; boundary toma decisao com classificacao real.
5. **Possiveis side effects:** middleware interrompido passa a interromper ativacao; error boundaries podem receber defects que antes pareciam failures, exigindo policy explicita.

Criterio de aceite: middleware com Redirect, Forbidden, typed failure, die e
interrupt produz cinco outcomes/Causes distintos e preserva classificacao no
boundary.

#### EFFECT-035 - O boundary JSX repara props hostis e produz Element parcial

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: `runJsx` captura qualquer throw do fast path e entra no caminho
defensivo em `packages/core/src/jsx-runtime.ts:67-102`; `readPropKeys` transforma
falha de `Object.keys` em lista vazia e `collectProps` omite getters que lancam em
`packages/core/src/internal/jsx-builder.ts:58-102`. Um prop `href` cujo getter
lanca pode desaparecer enquanto os demais props geram um Intrinsic bem-sucedido.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.2, "Defects" (unexpected throws podem permanecer defects), e secao 21.1, "Invalid Input or Stored Data" (`MUST`: input invalido produz typed boundary failure; `MUST NOT`: e aceito ou reparado silenciosamente sem Schema-specific semantics).
2. **Por que falhou:** exceptions de introspeccao sao convertidas em ausencia de props. O renderer nao sabe que recebeu um objeto incompleto e pode produzir UI funcionalmente ou semanticamente diferente sem erro.
3. **Possivel solucao:** retornar `InvalidJsxPropsError` com operacao/propriedade segura, ou preservar o throw como defect; abortar a construcao inteira, nunca omitir a parte que falhou.
4. **Ganhos esperados:** props invalidos falham visivelmente e nenhum Element parcial atravessa a boundary sync/Effect.
5. **Possiveis side effects:** Proxies/getters exoticos antes tolerados passam a falhar; o bridge sync precisa definir como materializar o erro sem perder a API JSX.

Criterio de aceite: falha em enumerate/getter produz typed failure ou defect
documentado e nenhum Element parcial e retornado.

### Build, Vite e transporte HTTP

#### EFFECT-036 - O Worker Cloudflare escrito no build nao e o Worker exercitado pelos testes

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: o planner possui um renderer privado em
`packages/core/src/vite/build-artifact-planner.ts:29-47` e grava seu conteudo em
`build-artifact-planner.ts:210-232`. Outro renderer, com regras diferentes para
document requests, assets e API, existe em
`packages/core/src/vite/plugin.ts:1942-2006`; os testes comportamentais o chamam
diretamente, enquanto o build executa as operacoes do primeiro em
`plugin.ts:2369-2382`. No artefato realmente planejado, o fallback pede
`/index.html`, que o binding redireciona para `/`, produzindo 307 em refresh de
rota profunda e em casos que deveriam permanecer 404.

1. **Referencia falha do RFC:** secao 7.2, "Canonical Representations" (`MUST NOT`: condicionais ad hoc criam uma segunda representacao concorrente do mesmo contrato), e secao 19.1, "Subject and Seams" (`MUST`: testes exercitam a implementacao real pelo seam usado em producao).
2. **Por que falhou:** duas funcoes independentes representam o mesmo artefato. Os testes provam a versao exportada do plugin, mas `GeneratedArtifactPlanner` escreve a versao privada mais simples; passar na suite nao diz nada sobre o Worker publicado.
3. **Possivel solucao:** manter um unico renderer compartilhado e fazer o planner produzir exatamente seu resultado; remover o caminho concorrente. Testar executando o `contents` da operacao `WriteFile`, nao outra helper.
4. **Ganhos esperados:** refresh de SPA, API 404, assets e metodos nao documentais obedecem ao comportamento testado no artefato final.
5. **Possiveis side effects:** snapshots do planner mudam; consumidores que contornavam o redirect do artefato antigo deixam de precisar do workaround.

Criterio de aceite: o `contents` realmente retornado pelo plano e executado em
testes para rota profunda, API 404, POST, asset ausente e fallback `/`, sem chamar
um segundo renderer.

Status da remediacao em 2026-08-29: **fechado apos reauditoria final**. O unico
Worker e o `contents` planejado por `GeneratedArtifactPlanner`, e os testes
importam e executam exatamente essa operacao. O fallback exige request documental
com `Accept` HTML e segmento final sem extensao depois de decodificacao segura;
`robots.txt`, PDF, fontes, source maps, imagens, extensoes desconhecidas e pontos
percent-encoded no segmento final preservam 404. Percent-encoding malformado e
separadores encoded como `%2F` ou `%5C` tambem falham fechados em 404, enquanto
rotas SPA extensionless usam `/` sem passar por `/index.html`.

#### EFFECT-037 - A API de desenvolvimento publica `Ready` mesmo quando a inicializacao falha

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: Node converte falhas de import, composicao e handler em `Option.none`
em `packages/core/src/vite/dev-platform-node.ts:84-134`; Bun repete o padrao em
`packages/core/src/vite/dev-platform-bun.ts:247-292`. Ambos retornam normalmente
de `makeApi`, entao `PluginApi.loadInitial` constroi `Ready` em
`packages/core/src/vite/plugin.ts:2875-2895` e `configureServer` registra "API
handlers loaded" em `plugin.ts:3243-3255`. A facade de web handler e lazy em
`plugin.ts:215-220`, portanto a aquisicao do Layer ainda pode falhar somente no
primeiro request.

1. **Referencia falha do RFC:** secao 10.1, "Typed Failures" (`MUST`: falhas operacionais esperadas permanecem tipadas ate tratamento deliberado), secao 16.1, "Configuration" (`SHOULD`: Service com inicializacao esta pronto quando fornecido), e secao 21.2, "Missing Dependencies and Readiness" (`MUST NOT`: um Service que nao estabelece readiness e fornecido como pronto).
2. **Por que falhou:** `Effect.option` e usado como logging/recovery total, apagando a falha que o owner de startup precisa observar. O estado externo descreve um handler disponivel mesmo quando o Ref esta vazio ou a aquisicao real ainda nao ocorreu.
3. **Possivel solucao:** observar com `tapError`, mas preservar a falha no canal durante carga inicial; adquirir e validar o Layer/handler sob o Scope da API antes de construir `Ready`. Se readiness lazy for intencional, modela-la como estado explicito com operacao de espera.
4. **Ganhos esperados:** startup, logs e middleware passam a concordar; erro de modulo ou Layer impede readiness em vez de responder 500 indefinidamente.
5. **Possiveis side effects:** `configureServer` passa a falhar cedo onde hoje continua degradado; Layers antes adquiridos no primeiro request passam a ser adquiridos durante startup.

Criterio de aceite: falha de import, composicao, criacao ou acquire produz
`Failed`, nao monta `Ready`, fecha recursos parciais e nao emite a mensagem de
sucesso.

#### EFFECT-038 - Reload descarta o handler saudavel antes de adquirir o substituto

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: Node descarta o handler atual antes de carregar o candidato em
`packages/core/src/vite/dev-platform-node.ts:75-92`, mas requests ainda podem ler
sua referencia em `dev-platform-node.ts:185-212`; Bun descarta e esvazia o estado
antes da carga em `packages/core/src/vite/dev-platform-bun.ts:222-256`. Ambos
apagam falhas com `Effect.option`. Em Bun, o contrato diz `dispose: () => void`
em `packages/core/src/vite/dev-platform.ts:91-94`, embora a implementacao real
possa devolver Promise; `Effect.try` em `dev-platform-bun.ts:226-232` nao a
aguarda.

1. **Referencia falha do RFC:** secao 10.1 (`MUST`: falha operacional permanece no canal tipado), secao 12.1, "Structured Ownership" (`MUST`: owner observa falha e aguarda finalizacao), e secao 23.5, "Startup and Shutdown" (`SHOULD`: troca e shutdown fecham recursos em ordem controlada).
2. **Por que falhou:** o reload usa dispose-then-acquire sem estado de draining. Node pode servir pelo handler ja finalizado; Bun fica indisponivel. Se o candidato falha, o handler anterior ja foi perdido e a operacao ainda resolve com sucesso. Dispose assincrono pode concorrer sem observacao com a nova instancia.
3. **Possivel solucao:** adquirir e validar o candidato primeiro, trocar o estado atomicamente e somente depois aguardar o descarte do antigo. Se coexistencia for impossivel, expor `Draining`/`Unavailable`. Tipar dispose como Effect ou Promise e sempre aguarda-lo.
4. **Ganhos esperados:** reload invalido preserva o ultimo handler saudavel; reload valido tem um ponto de troca linearizavel e finaliza cada instancia exatamente uma vez.
5. **Possiveis side effects:** por um curto periodo duas instancias podem coexistir; se os Layers possuem recursos exclusivos, sera necessario um protocolo explicito de draining em vez de acquire-first.

Criterio de aceite: com acquires/finalizers e requests coordenados por `Deferred`,
falha preserva o handler antigo e sucesso troca antes de descarta-lo, sem uso apos
finalizacao nem Promise rejeitada.

#### EFFECT-039 - O lifecycle do Vite nao descarta o `ManagedRuntime` nem todos os API Scopes

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: o runtime e criado em `packages/core/src/vite/plugin.ts:3097-3108` e
nenhum hook chama `dispose`/`disposeEffect`; `closeBundle` termina sem isso em
`plugin.ts:3404-3423`. O API Scope e criado manualmente em `plugin.ts:2875-2884`
e fechado no caminho de falha tipada, mas a ligacao ao host usa apenas
`httpServer?.on("close", ...)` e nao aguarda a Promise em
`plugin.ts:2983-2990`; middleware mode nao possui `httpServer`.

1. **Referencia falha do RFC:** secao 9.5, "Runtime Ownership" (`MUST`: o owner de `ManagedRuntime` o descarta quando termina o lifecycle do host), secao 12.4, "Resource Acquisition" (`MUST`: recurso adquirido possui owner estrutural e finalizer), e secao 23.5 (`SHOULD`: shutdown para admissao, interrompe trabalho e fecha recursos em ordem).
2. **Por que falhou:** runtime e Scope sao recursos manuais espalhados por callbacks opcionais. Defect/interrupcao durante carga pode escapar do cleanup, middleware mode nao recebe fechamento e o callback de close dispara trabalho que o Vite nao espera.
3. **Possivel solucao:** criar uma operacao single-flight de shutdown possuida pelo plugin e memoizar a mesma Promise para todos os hooks concorrentes. Parar watcher/admissao, interromper e aguardar reloads/requests, fechar API Scopes e por ultimo chamar diretamente `await pluginRuntime.dispose()`; alternativamente executar `disposeEffect` com `Effect.runPromise`, nunca pelo proprio `pluginRuntime`. Ligar essa Promise aos hooks de servidor/build que o host realmente aguarda.
4. **Ganhos esperados:** Layers, handlers, watchers e Fibers nao sobrevivem ao servidor/build; testes que criam plugins nao acumulam runtimes.
5. **Possiveis side effects:** fechamento passa a aguardar finalizers e pode revelar recursos que nunca terminam; hooks precisam coordenar chamadas duplicadas de shutdown.

Criterio de aceite: servidor normal, middleware mode, erro de build e dois
fechamentos concorrentes recebem a mesma conclusao de shutdown; todos aguardam o
mesmo finalizer bloqueado e o runtime so fica inutilizavel depois.

#### EFFECT-040 - As bridges HTTP aceitam body ilimitado e nao propagam desconexao

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: a bridge Node gerada acumula todos os chunks em memoria em
`packages/core/src/vite/plugin.ts:231-251`; a bridge Bun equivalente faz o mesmo
em `packages/core/src/vite/dev-platform-bun.ts:56-89`. Nenhuma liga
`aborted`/`close` a um `AbortController` do `Request`, e o reader da resposta nao
e cancelado se escrita falha em `plugin.ts:270-290` e
`dev-platform-bun.ts:161-185`. Requests sao iniciados como roots por Promise em
`plugin.ts:298-307` e pelos middlewares dos adapters.

1. **Referencia falha do RFC:** secao 10.4, "Interruption" (`MUST`: interruption permanece observavel; `SHOULD`: Promise adapters propagam `AbortSignal` quando a API suporta), secao 12.5, "Overload" (`SHOULD`: input nao seguramente limitado define capacidade/overflow), secao 16.3, "External APIs" (`MUST`: conter Promise, callback e recursos nativos), e secao 23.2 (`SHOULD`: capacidade torna crescimento seguro).
2. **Por que falhou:** cliente pode enviar chunks sem limite ou fechar antes de `end`; a Promise permanece pendente, retendo chunks e handler. Como o `Request.signal` nunca e abortado, o runtime Effect nao interrompe o trabalho. Falha de resposta tambem abandona o stream reader sem release.
3. **Possivel solucao:** impor limite incremental tipado ou usar bridge streaming existente; registrar listeners com cleanup; abortar o Request na desconexao; supervisionar requests no API Scope; cancelar/liberar reader em `acquireUseRelease`/`ensuring`.
4. **Ganhos esperados:** memoria e lifetime ficam limitados, disconnect cancela trabalho e shutdown consegue aguardar requests ativos.
5. **Possiveis side effects:** requests acima do limite passam a receber 413; streaming altera o tipo/body disponivel e exige policy explicita para backpressure e erro parcial.

Criterio de aceite: body acima do limite, chunked sem `Content-Length`, abort antes
de `end`, disconnect durante resposta e shutdown ativo encerram Fibers, removem
listeners e liberam readers.

#### EFFECT-041 - O checker ignora diagnosticos sem arquivo e erros semanticos do `tsconfig`

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: `parseJsonConfigFileContent` produz `parsed.errors` em
`packages/core/src/check/checker.ts:158-164`, mas a lista consultada em
`checker.ts:205-216` nao inclui `getConfigFileParsingDiagnostics`; depois, todo
diagnostico sem `diagnostic.file` e descartado em `checker.ts:221-225`. Um
`target: "NOT_A_TARGET"` gera TS6046 para o compilador, mas `checkProject` pode
retornar zero erros e o CLI sair 0.

1. **Referencia falha do RFC:** secao 7.1, "Boundary Decoding" (`MUST`: configuracao transportada e validada antes do uso), secao 16.1 (`MUST`: configuracao externa e decodificada/validada no boundary), e secao 21.1 (`MUST`: input invalido produz falha tipada).
2. **Por que falhou:** o checker filtra diagnosticos pela existencia de source file, embora erros de opcoes e config pertencam ao projeto inteiro. Passar `parsed.errors` ao Program nao os adiciona automaticamente aos getters selecionados.
3. **Possivel solucao:** coletar config parsing e global diagnostics; representar os que nao possuem arquivo como diagnosticos de projeto associados ao `tsconfigPath`, sem aplicar filtro de sources externas.
4. **Ganhos esperados:** o quality gate nao aprova configuracao que TypeScript rejeita nem verifica silenciosamente com defaults diferentes.
5. **Possiveis side effects:** projetos hoje "verdes" com opcoes invalidas passam a falhar; formato de `CheckDiagnostic` precisa suportar local de projeto sintetico.

Criterio de aceite: target/opcoes invalidas, zero inputs e global diagnostics
aparecem no resultado e fazem o CLI sair 1.

Status da remediacao em 2026-08-27: **fechado apos reauditoria**. `checkProject`
agrega diagnosticos de config, opcoes, globais, sintaticos e semanticos, associa
os diagnosticos sem arquivo ao `tsconfig.json` e o teste de processo real cobre
TS1109, TS2322, TS6046, TS18003 e TS2318 com exit code 1.

#### EFFECT-042 - Config e startup do servidor gerado escapam de Schema e readiness

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: `TryggConfig` e apenas interface e `defineConfig` retorna o objeto sem
decode em `packages/core/src/config.ts:69-97`; o plugin ramifica diretamente em
`packages/core/src/vite/plugin.ts:3088-3107`. O servidor gerado usa
`Number(process.env.PORT)`, `HOST` cru e `readFileSync` antes do runtime em
`plugin.ts:2155-2165`, e registra "Server listening" antes de `Layer.launch` em
`plugin.ts:2191-2196`.

1. **Referencia falha do RFC:** secao 7.1 (`MUST`: dados transportados/config sao decodificados), secao 16.1 (`MUST`: config externa e validada; `SHOULD`: Service esta pronto quando fornecido), secao 16.3 (`MUST`: throws externos sao contidos), e secao 21.2 (`MUST NOT`: readiness e anunciada antes da aquisicao).
2. **Por que falhou:** a type annotation desaparece no boundary JavaScript; platform/output invalidos seguem para planejamento. PORT invalida e shell ausente lancam fora do Effect, e bind ocupado pode falhar depois da mensagem de sucesso.
3. **Possivel solucao:** criar Schemas canonicos para `TryggConfig` e env do servidor, com defaults/ranges; decodificar uma vez no plugin/startup; mover leitura do shell para Effect tipado; emitir readiness somente depois que o server Layer adquiriu o socket.
4. **Ganhos esperados:** configuracao invalida falha cedo e tipadamente; logs de listening passam a comprovar disponibilidade real.
5. **Possiveis side effects:** campos extras/literais antes ignorados podem falhar; a mensagem de readiness muda de ponto e testes de generated source precisam ser atualizados.

Criterio de aceite: config runtime invalida, limites de PORT, shell ausente e
porta ocupada falham por tipos project-owned e nunca emitem "listening" antes de
acquire bem-sucedido.

#### EFFECT-043 - O watcher aceita Promise, mas o callback nativo nao possui seu resultado

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: `ViteServerSource` permite callback que retorna Promise em
`packages/core/src/vite/plugin.ts:2627-2630`; `configureServer` registra um
callback `async` em `plugin.ts:3261-3277`. O `FSWatcher` real trata listeners como
`void`, portanto rejeicao de regeneracao, filesystem ou reload nao e observada
nem pertence ao Scope fechado pelo plugin.

1. **Referencia falha do RFC:** secao 12.1, "Structured Ownership" (`MUST`: owner observa falha, interrompe e aguarda todo trabalho forkado), e secao 16.3 (`MUST`: Promise e callback externos sao contidos pelo adapter).
2. **Por que falhou:** a assinatura interna sugere que o host aguarda Promise, mas EventEmitter ignora o retorno. Um erro esperado em HMR vira `unhandledRejection`; shutdown nao sabe que o callback ainda executa.
3. **Possivel solucao:** listener nativo deve retornar `void` e submeter explicitamente um Effect a `FiberSet`/owner supervisionado do plugin, com terminal `onExit`; shutdown interrompe e aguarda esse owner.
4. **Ganhos esperados:** falhas de watcher recebem um diagnostico unico e nenhum trabalho HMR escapa do lifecycle do Vite.
5. **Possiveis side effects:** eventos simultaneos precisam de policy de serializacao/coalescing e shutdown pode esperar regeneracao em curso.

Criterio de aceite: callback que falha nao produz `unhandledRejection`, chega uma
vez ao reporter e e interrompido/aguardado no fechamento.

#### EFFECT-044 - Interromper o bootstrap deixa readiness pendente para sempre

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: `Bootstrap.initialize` muda o Ref para `Bootstrapping` antes de
executar `makeState` em `packages/core/src/vite/bootstrap.ts:111-138`; somente o
canal tipado chama `markFailed` em `bootstrap.ts:126-130`. Defect ou interrupcao
nao restaura o estado nem completa o `Deferred` que `awaitReady` espera em
`bootstrap.ts:141-149`.

1. **Referencia falha do RFC:** secao 10.4 (`MUST`: interrupcao permanece observavel), secao 12.3 (`SHOULD`: Deferred settlement e waiter interruption permanecem internos ao owner), e secao 16.1 (`MUST`: readiness remanescente e explicita e honesta).
2. **Por que falhou:** a transicao para estado intermediario e o settlement do Deferred nao sao interruption-safe. Depois que a Fiber owner some, todos os callers futuros aguardam uma promessa que nenhuma Fiber pode completar.
3. **Possivel solucao:** proteger transicao e instalacao de finalizer com `uninterruptibleMask`/`onExit`; definir se cancelamento restaura `Pending` para retry ou completa todos os waiters com falha/cancelamento tipado.
4. **Ganhos esperados:** bootstrap sempre atinge estado terminal ou retentavel e hooks posteriores nao entram em deadlock invisivel.
5. **Possiveis side effects:** retry apos interrupcao exige garantir que recursos parciais foram fechados; completar Deferred com falha torna cancelamento observavel a todos os waiters.

Criterio de aceite: typed failure, defect e interrupcao depois da transicao
completam todos os waiters conforme a policy e nunca deixam `Bootstrapping`
orfao.

#### EFFECT-045 - Erros de filesystem sao recuperados como "arquivo ausente"

Severidade: **Media**. Classe: **violacao normativa**.

Evidencias: checks de existencia aplicam `Effect.orElseSucceed(() => false)` em
`packages/core/src/vite/plugin.ts:1317-1321,1679-1680,1729-1733,1773-1780`; o
servidor gerado transforma qualquer rejeicao de `readFile` em `"not-found"` e
fallback em `plugin.ts:2093-2108`. Permissao, `EMFILE` e I/O transitorio ficam
indistinguiveis de `NotFound`.

1. **Referencia falha do RFC:** secao 10.1 (`MUST`: falhas operacionais externas permanecem tipadas ate recovery deliberado), secao 16.3 (`MUST`: adapters traduzem falhas externas sem perder protocolo), e secao 17.5 (`SHOULD`: recovery degradado permanece observavel).
2. **Por que falhou:** um fallback amplo redefine toda falha do port como ausencia. Build pode omitir `app/api.ts`, conservar tipos stale ou responder 404 quando o filesystem esta indisponivel.
3. **Possivel solucao:** retornar false/fallback somente para reason `NotFound`; mapear as demais `PlatformError`s para `PluginFileSystemError` com operacao e path seguros.
4. **Ganhos esperados:** ausencia continua recuperavel, enquanto permissao/capacidade/I/O interrompem o build ou request com diagnostico verdadeiro.
5. **Possiveis side effects:** ambientes com permissoes defeituosas deixam de degradar silenciosamente e passam a falhar, possivelmente revelando configuracao operacional existente.

Criterio de aceite: adapters controlados distinguem NotFound, PermissionDenied e
falha transitoria para `exists`, `stat` e `readFile`.

#### EFFECT-046 - A bridge perde headers repetidos, inclusive `Set-Cookie`

Severidade: **Media**. Classe: **violacao normativa**.

Evidencias: `toNodeResponse` itera `Headers.forEach` e chama `setHeader` uma vez
por valor em `packages/core/src/vite/plugin.ts:270-274` e
`packages/core/src/vite/dev-platform-bun.ts:161-164`. Para headers nao combinaveis,
especialmente `Set-Cookie`, a representacao Web precisa preservar entradas; a
segunda escrita pode substituir a primeira no `ServerResponse`.

1. **Referencia falha do RFC:** secao 21.6, "Unsupported Adapter Behavior" (`MUST`: adapter incapaz de preservar o contrato do port falha explicitamente durante construcao ou operacao; `MUST NOT`: o enfraquece silenciosamente).
2. **Por que falhou:** a conversao assume que todo header e uma string combinavel. Cookies separados possuem semantica propria e virgulas em `Expires`, portanto join/sobrescrita altera a resposta.
3. **Possivel solucao:** tratar `set-cookie` por `Headers.getSetCookie()` e passar array ao Node; definir preservacao explicita para outros headers multivalorados.
4. **Ganhos esperados:** sessoes, refresh tokens, CSRF e atributos de cookies nao sao perdidos no adapter de desenvolvimento.
5. **Possiveis side effects:** shape observada em testes Node muda de string para array para headers repetidos; runtimes sem `getSetCookie` precisam de adapter versionado.

Criterio de aceite: resposta com dois cookies, incluindo `Expires` com virgula,
chega ao `ServerResponse` como duas entradas distintas.

#### EFFECT-047 - O fallback HTML transforma qualquer defect/interrupcao em `next()`

Severidade: **Media**. Classe: **violacao normativa**.

Evidencias: transformacao HTML e escrita de response inteira terminam em
`Effect.catchCause(() => next())` em
`packages/core/src/vite/plugin.ts:2994-3014`; a Promise externa ainda silencia a
rejeicao. Um throw de `res.setHeader` depois de mutacao parcial e tratado como
miss normal do middleware.

1. **Referencia falha do RFC:** secao 10.3, "Cause Handling" (`MUST NOT`: `catchCause` transforma defect ou interrupcao em fallback success acidentalmente), e secao 10.4 (`MUST`: interrupcao permanece observavel).
2. **Por que falhou:** recovery nao discrimina falha esperada de transform, bug de response e shutdown. `next()` pode permitir que middleware posterior tente responder novamente depois que status/headers ja mudaram.
3. **Possivel solucao:** recuperar somente o erro tipado esperado de transform antes de tocar na response; depois do primeiro commit, defects e interrupcao seguem ao owner terminal com a Cause preservada.
4. **Ganhos esperados:** misses continuam compondo com Vite, enquanto bugs e cancelamento nao sao mascarados nem geram resposta dupla.
5. **Possiveis side effects:** alguns erros antes silenciosos passam a aparecer e podem encerrar o request; o adapter precisa de reporter terminal seguro.

Criterio de aceite: falha tipada pre-commit chama `next`; throw de response
permanece defect; interrupcao nao chama `next`; cada caso e afirmado por
`Exit`/`Cause`.

#### EFFECT-048 - O codegen de rotas infere outputs de Schema por regex e inventa `string`

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `schemaToType` reconhece poucos textos e retorna `"string"` para todo
o resto em `packages/core/src/vite/plugin.ts:680-720`; `parseSchemaStruct` e
`parseRoutes` extraem TypeScript por regex em `plugin.ts:723-800`, e somente
aceitam `Schema.Struct` inline em `plugin.ts:830-847`. Schemas transformadoras
como `DateFromString`, arrays e BigInt geram declaracao `string`; uma
`.params(Params)` referenciada pode gerar lista vazia. O teste em
`packages/core/src/vite/__tests__/plugin.test.ts:2842-2844` institucionaliza o
fallback silencioso.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 7.1, "Boundary Decoding" (`MUST`: a representacao de transporte e transformada pelo Schema canonico), secao 7.2 (`MUST NOT`: uma segunda representacao concorrente contradiz o Schema), e secao 21.1 (`MUST NOT`: input/representacao invalida e aceita ou reparada silenciosamente).
2. **Por que falhou:** source text e usado como substituto do tipo de output de `Schema`. Regex nao resolve identificadores, aliases, transforms, brands ou composicao e o fallback fabrica uma API compilavel, porem falsa, em vez de declarar incapacidade.
3. **Possivel solucao:** derivar tipos pelo TypeScript checker e pela referencia a `Schema.Schema.Type<typeof S>`, ou preservar a expressao/import no `.d.ts`; quando uma construcao nao puder ser resolvida, falhar o build com `PluginParseError`, nunca supor string.
4. **Ganhos esperados:** tipos gerados concordam com runtime para transforms e schemas reutilizados; consumidores nao compilam contra params/query inexistentes ou de tipo errado.
5. **Possiveis side effects:** patterns antes aceitos pelo fallback passam a exigir suporte do codegen ou falhar explicitamente; generated declarations e testes mudam.

Criterio de aceite: schemas inline/referenciados, aliases, brands, transforms,
arrays, BigInt e Date produzem `Schema.Schema.Type<typeof S>` correto ou erro
tipado de build, sem fallback silencioso.

Status da remediacao em 2026-08-29: **fechado apos reauditoria final**. O codegen
usa AST e TypeChecker para comparar a identidade canonica do `Route` exportado
por Trygg, inclusive aliases `const`, namespaces, reexports, destructuring
`const { Route: R } = Router` e element access `Router["Route"]`, sem confiar no
nome do identificador nem aceitar lookalikes locais. Builders imutaveis aceitam
`.params`/`.query` por property access ou element access cujo nome o checker
resolve estaticamente e geram mapas distintos de `Type` e `Encoded`, inclusive
`number`/`string` para `NumberFromString`. Receiver nao imutavel, anotacao ou cast
para `any`, reassignment, condicional e nome computed dinamico associados a um
builder descoberto falham com `PluginParseError`, nunca com fallback raw. As
declaracoes sao compiladas diretamente com consumidores `Link`/`navigate`, e o
boundary Vite transpile-only preserva a mesma falha tipada.

### Sinais e reatividade

#### EFFECT-049 - `Signal.update` perde read-modify-writes concorrentes

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `Signal.update` le `_cell.value`, cruza Effects de disposal/equality
e so entao grava em `packages/core/src/primitives/signal.ts:727-755`; `modify`
faz a transicao sincrona antes da notificacao em `signal.ts:772-784`. Com
`Scheduler.MaxOpsBeforeYield = 5`, 100 updates concorrentes de `n + 1` terminaram
em 1, enquanto 100 modifies terminaram em 100.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2, "Primitive Selection" (a escolha de Ref/mutex determina atomicidade e ordering), e secao 5.2, "Requirement Strength" (`SHOULD`: review decisions sao ligadas a failure mode concreto).
2. **Por que falhou:** a celula mutavel nao possui gate e o read-modify-write atravessa pontos de yield. Varias Fibers leem o mesmo valor anterior, calculam o mesmo proximo valor e sobrescrevem umas as outras.
3. **Possivel solucao:** serializar check/read/equality/write por Signal com semaphore/mutex, liberando antes de notificar listeners; alternativamente tornar um `Ref` a fonte authoritative e separar commit atomico de fanout.
4. **Ganhos esperados:** updates concorrentes deixam de desaparecer e a API passa a ter ordering definido.
5. **Possiveis side effects:** mutacoes concorrentes passam a esperar; listeners nao podem executar dentro do lock, pois podem reentrar no mesmo Signal.

Criterio de aceite: N Fibers liberadas por uma barreira produzem exatamente N
incrementos, e listener reentrante nao deadlocka o gate.

#### EFFECT-050 - Derivacoes podem retornar snapshot stale adquirido antes da subscription

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `derive` le e calcula o inicial antes de `subscribe` em
`packages/core/src/primitives/signal.ts:1067-1082`; `deriveAll` faz o mesmo em
`signal.ts:1168-1197`; `cx` repete a ordem em
`packages/core/src/primitives/cx.ts:160-176`. Uma mudanca entre snapshot e
instalacao do listener nao e observada. Em interleaving controlado, source 1
produziu derived 0, e class source `b` produziu `"x a"`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2 (a primitive/protocolo determina atomicidade e ordering), e secao 5.2 (`SHOULD`: review decisions sao ligadas a failure mode concreto).
2. **Por que falhou:** aquisicao usa read-then-subscribe sem handshake ou revalidacao. A subscription comeca depois do evento que deveria convergir o output e nenhuma nova mudanca e necessaria para corrigi-lo.
3. **Possivel solucao:** instalar todas as subscriptions e reler/reconciliar uma vez antes de devolver o output, como o handshake ja usado por `render-signal-element.ts:271-275`; equality evita notificacao redundante.
4. **Ganhos esperados:** `derive`, `deriveAll`, `cx` e consumidores de reactive matcher retornam uma visao coerente mesmo sob mudanca durante aquisicao.
5. **Possiveis side effects:** a projection pode executar uma vez adicional; funcoes impuras continuarao inadequadas e devem ser documentadas/testadas como tais.

Criterio de aceite: barreira entre snapshot e subscribe muda cada source e o
resultado retornado ja corresponde ao valor mais recente, sem sleep.

#### EFFECT-051 - `Signal.suspend` cria um Scope independente sem owner fora de Component

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: quando `CurrentComponentScope` e nulo, `Signal.suspend.run` chama
`Scope.make()` em `packages/core/src/primitives/signal.ts:1681-1693`; trabalho e
finalizer sao registrados nesse Scope em `signal.ts:1784-1799`, mas ele nao e
filho do Scope ambiente nem e fechado por outro owner.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.1, "Structured Ownership" (`MUST`: todo trabalho forkado tem owner que interrompe e aguarda), e secao 12.4, "Resource Acquisition" (`MUST`: recurso com release possui owner estrutural e finalizer).
2. **Por que falhou:** `Scope.make` cria uma raiz manual, nao uma relacao com o caller. Fechar o Effect scoped que chamou `Signal.suspend` deixa render, subscriptions e view Signal vivos indefinidamente.
3. **Possivel solucao:** usar o Scope ambiente diretamente ou obter o parent com `Effect.scope` e criar `Scope.fork(parent)` quando isolamento filho for necessario; fechar o filho no teardown correspondente.
4. **Ganhos esperados:** trabalho termina com caller/unmount e todos os recursos internos possuem caminho de finalizacao.
5. **Possiveis side effects:** usos fora do Renderer deixam de sobreviver ao Effect de aquisicao; quem precisar de lifetime maior deve fornece-lo explicitamente.

Criterio de aceite: bloquear o source, fechar o Scope ambiente e provar
interrupcao, subscription removida e view Signal disposto.

#### EFFECT-052 - Boundaries reativos apagam failure, defect e interruption

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `notifyListeners` captura toda Cause e retorna sucesso em
`packages/core/src/primitives/signal.ts:1249-1279`; `Signal.suspend` transforma
todo Exit failure em view de Failure em `signal.ts:1740-1764`; keyed row e update
tambem recuperam qualquer Cause para Trace em
`packages/core/src/primitives/render-keyed-list.ts:658-680,834-837`. Assim,
listener interrompido faz `Signal.set` suceder, interrupcao de suspend vira UI de
erro e defect de row desaparece do owner.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.3, "Cause Handling" (`MUST`: recovery de negocio opera no canal tipado; `MUST NOT`: `catchCause` transforma defect/interrupcao em fallback success), e secao 10.4 (`MUST`: interrupcao permanece observavel).
2. **Por que falhou:** error isolation foi implementada no nivel de Cause sem classificacao. A policy documentada para failures de listener acaba incluindo cancelamento e bugs, e os forks de keyed list nao possuem terminal que reemita a Cause.
3. **Possivel solucao:** isolar somente failures deliberadamente recuperaveis; reemitir Causes com interrupt/die via `Effect.failCause`; entregar falha de keyed row ao error boundary/owner; modelar cancelamento local como outcome `Cancelled`, se necessario.
4. **Ganhos esperados:** cancellation funciona, defects chegam ao supervisor e somente erros previstos geram estado/fallback reativo.
5. **Possiveis side effects:** sets/renders antes aparentemente bem-sucedidos passam a interromper ou falhar o owner; a policy de listener tipado precisa dizer se um erro interrompe siblings ou apenas e reportado.

Criterio de aceite: matriz fail/die/interrupt para listener, suspend e keyed row
preserva a classificacao em Exit/Cause e gera fallback apenas para o caso
deliberadamente recuperavel.

#### EFFECT-053 - Keyed diff remove o DOM confirmado antes de validar o proximo snapshot

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: removals e fechamento de Scopes ocorrem primeiro em
`packages/core/src/primitives/render-keyed-list.ts:412-484`; somente depois novas
rows sao construidas em `render-keyed-list.ts:509-724`. Uma falha posterior e
absorvida por `catchCause` em `render-keyed-list.ts:834-837`. Trocar rows `a,b`
por uma row cuja criacao falha deixa o DOM vazio em vez de preservar `ab`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2, "Primitive Selection" (a primitive/protocolo escolhido determina atomicidade e ordering), e secao 5.2 (`SHOULD`: review decisions sao ligadas ao failure mode concreto, nao a preferencia de implementacao).
2. **Por que falhou:** a fase destrutiva acontece antes de a nova representacao poder ser committed. Quando create falha, nao ha rollback para DOM, `itemStates`, key order ou Scopes antigos ja fechados.
3. **Possivel solucao:** renderizar e validar novas rows em `DocumentFragment` sob Scopes staged; somente depois aplicar removals/moves e transferir ownership. Em falha, limpar staging e manter snapshot anterior integral.
4. **Ganhos esperados:** uma atualizacao falha nao apaga UI confirmada e retry parte de estado coerente.
5. **Possiveis side effects:** durante staging coexistem recursos antigos e novos e o pico de memoria cresce; commit precisa definir tratamento de cleanup failure posterior.

Criterio de aceite: falha ao substituir, adicionar ou rerenderizar preserva DOM e
state anteriores, fecha staging e reporta uma Cause exatamente uma vez.

#### EFFECT-054 - Reorder preserva rows e indices stale

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `needsRerender` considera somente identidade do item em
`packages/core/src/primitives/render-keyed-list.ts:527-540`; rows movidas sao
excluidas da lista em `render-keyed-list.ts:793-797`, e qualquer move suprime
todos os rerenders em `render-keyed-list.ts:813-820`. `[A,B] -> [B2,A2]` produz
`BA`, nao `B2A2`; com objetos identicos e render dependente de index, o output
mantem indices antigos.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2 (ordering e atomicidade sao parte da correcao da primitive), e secao 5.2 (`SHOULD`: review decisions sao ligadas a failure mode concreto).
2. **Por que falhou:** move e content refresh foram tratados como mutuamente exclusivos. A identidade da key preserva a row, mas nao torna item/index anteriores validos depois da nova ordem.
3. **Possivel solucao:** considerar mudanca de item ou index; concluir moves, atualizar `keyOrder/currentIndex` e depois agendar todas as rows cujo render input mudou.
4. **Ganhos esperados:** keys preservam identidade DOM sem preservar conteudo obsoleto.
5. **Possiveis side effects:** reorder passa a rerenderizar rows quando callback depende de index ou item novo, aumentando trabalho necessario para cumprir a API.

Criterio de aceite: testes combinam reorder com novos objetos e com output
dependente de index, mantendo ordem, valor e identidade esperados.

#### EFFECT-055 - Coalescing de SignalElement ocorre depois de criar Fibers sem limite

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: cada notificacao cria uma Fiber em
`packages/core/src/primitives/render-signal-element.ts:147-153`; version check e
coalescing so ocorrem depois que ela espera o semaphore em
`render-signal-element.ts:153-160`. Cem updates com primeiro render bloqueado
criaram cem Fibers, embora apenas duas chamadas de render fossem uteis.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.5, "Overload" (`SHOULD`: concorrencia sem limite exige bound externo concreto), e secao 23.2, "Backpressure and Memory" (`SHOULD`: capacidade/overflow tornam crescimento seguro).
2. **Por que falhou:** latest-wins reduz trabalho apenas dentro do worker, mas admissao ja alocou uma Fiber por evento. Sob Signal de alta frequencia, waiters crescem com o burst.
3. **Possivel solucao:** manter um unico worker owned com flag/version `pending`, ou `Queue.sliding(1)` com capacidade explicita; admitir no maximo o valor em execucao e o latest pendente.
4. **Ganhos esperados:** memoria e scheduler work ficam O(1) durante churn sem perder a semantica latest-wins declarada.
5. **Possiveis side effects:** updates intermediarios e seus hooks deixam deliberadamente de executar; terminal/onSwap deve pertencer apenas ao valor committed.

Criterio de aceite: milhares de mudancas com worker bloqueado mantem um worker e
um valor pendente, depois commitam somente o latest.

#### EFFECT-056 - Keys duplicadas deixam row e Scope sem owner

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: o contrato exige key unica em
`packages/core/src/primitives/signal.ts:1847-1852`, mas o diff apenas cria `Set`
em `packages/core/src/primitives/render-keyed-list.ts:393-396`; `itemStates.set`
sobrescreve a primeira row em `render-keyed-list.ts:690-722`. Duas rows com a
mesma key renderizam ambas, mas cleanup conhece apenas a ultima e deixa a primeira
no DOM.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.4 (`MUST`: recurso adquirido com release possui owner/finalizer), e secao 21.1 (`MUST`: invalid input falha no boundary; `MUST NOT`: e aceito silenciosamente).
2. **Por que falhou:** `Map` conserva um state por key enquanto `keyOrder` e DOM aceitam duplicatas. O overwrite torna a primeira row e seu Scope inalcancaveis pelo teardown.
3. **Possivel solucao:** detectar duplicatas antes de qualquer mutacao e falhar tipadamente, preservando o snapshot anterior.
4. **Ganhos esperados:** erro de caller e fail-loud e nao vira leak de DOM, listener ou Scope.
5. **Possiveis side effects:** listas que dependiam de comportamento indefinido passam a falhar; custo continua O(n), pois o Set ja e construido.

Criterio de aceite: duplicata inicial e em update falha antes do commit e cada row
valida e finalizada exatamente uma vez.

#### EFFECT-057 - Subscription pode ser instalada depois que o Signal foi disposto

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: disposal limpa `_listeners` em
`packages/core/src/primitives/signal.ts:409-423`; `subscribe` adiciona sem
verificar `_disposed` em `signal.ts:1300-1327`, e `subscribeUnsafe` repete em
`signal.ts:1355-1363`. Apos fechar o owner Scope, uma nova subscription aumenta o
Set de zero para um, sem owner capaz de limpa-la automaticamente.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 12.2, "Primitive Selection" (a primitive/gate determina atomicidade e ordering), e secao 5.2 (`SHOULD`: review decisions sao ligadas a failure mode concreto).
2. **Por que falhou:** dispose e registration nao compartilham gate de lifecycle. Um Signal terminal continua aceitando callbacks que nunca receberao update e podem reter Context indefinidamente.
3. **Possivel solucao:** sob a mesma transicao atomica de lifecycle, rejeitar subscription a Signal disposed ou devolver unsubscribe no-op; corrida deve terminar em "instalada e removida" ou "nao instalada".
4. **Ganhos esperados:** referencias stale nao acumulam callbacks e o contrato de disposal permanece verdadeiro.
5. **Possiveis side effects:** subscription tardia passa a falhar ou no-op explicitamente; escolher a policy e refletir no tipo/documentacao.

Criterio de aceite: subscribe apos close nao aumenta listeners, e corrida entre
subscribe/close sempre termina com zero subscriptions.

### CLI e templates publicados

#### EFFECT-058 - O template publica mutacoes HTTP sem decisao de autorizacao

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: o template `incident` expoe `POST /incidents` e
`POST /incidents/:id/transition` em
`packages/cli/templates/incident/app/api.ts:62-88`; os handlers mutam o Service
em `api.ts:116-143`. Nao existe middleware, principal autenticado ou policy
explicita antes dessas operacoes.

1. **Referencia falha do RFC:** secao 18.4, "Authorization" (`MUST`: autenticacao/autorizacao concluem antes de mutacao ou aquisicao cara), e secao 27.1, "Input and Authorization" (`MUST`: authorization e aplicada em boundary confiavel e validacao nao a substitui).
2. **Por que falhou:** o template demonstra payload Schema, mas trata input valido como autoridade para criar/transicionar incidentes. Qualquer cliente que alcance o servidor possui capacidade de mutacao, sem uma decisao revisavel dizendo sequer que acesso anonimo e intencional.
3. **Possivel solucao:** adicionar middleware HttpApi que autentique e autorize antes de `Incidents`; se o demo for deliberadamente anonimo, representar/documentar essa policy explicitamente e limitar sua exposicao.
4. **Ganhos esperados:** o scaffold ensina o boundary correto e impede mutacao por clientes nao autorizados quando usado fora de ambiente local.
5. **Possiveis side effects:** surgem respostas 401/403 e configuracao/credenciais de demo; clientes anonimos atuais deixam de ser compativeis.

Criterio de aceite: request sem identidade falha antes de mutar ou adquirir o
Service protegido; identidade autorizada conclui; payload valido nunca e tratado
como substituto de autorizacao.

#### EFFECT-059 - O template `incident` exporta um grafo executavel incompleto

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: `bun run typecheck:templates` falha em
`packages/cli/templates/incident/app/routes.ts:20,23,28`: `IncidentsIndex` e
`IncidentDetail` ainda exigem `ApiClient`; `Settings` exige `AppTheme`. Os
providers colocados no Layout em
`packages/cli/templates/incident/app/layout.tsx:143` nao satisfazem o contrato
estatico dos Route Components.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secoes 5.1, "Quality Verticals", e 9.3, "Placement and Sharing", por analogia com ownership e identidade de Services. A secao 21.2 nao foi violada: o typecheck rejeita corretamente os requirements insatisfeitos; o defeito e o template frontend publicado permanecer nesse estado.
2. **Por que falhou:** layout e manifest de rotas sao boundaries de composicao independentes no tipo. O template assume que providers do layout satisfazem paginas, mas o router rejeita essa inferencia; o projeto publico gerado nao compila.
3. **Possivel solucao:** estabelecer um unico boundary de composicao conhecido pelo layout e pelas rotas. Evitar fornecer `AppThemeDark` novamente apenas em Settings, pois isso criaria estado/listener isolado do Signal usado em `<html>`; preservar uma identidade compartilhada.
4. **Ganhos esperados:** scaffold passa no typecheck e pages observam exatamente os Services da aplicacao, sem casts nem Layers duplicados.
5. **Possiveis side effects:** pode exigir API de router para requirements providos no app root ou wrappers explicitos para pages; tipos de route definition mudam.

Criterio de aceite: o template compila e uma integracao muda o tema em Settings,
observa o mesmo Signal no `<html>` e prova uma unica aquisicao do Service.

#### EFFECT-060 - Processos filhos do CLI nao preservam falha, interrupcao ou finalizacao

Severidade: **Alta**. Classe: **violacao normativa**.

Evidencias: VCS usa `Effect.promise`, `spawn(..., { shell: true })`, escuta apenas
`close` e resolve inclusive para exit code nao zero em
`packages/cli/index.ts:143-161`. Install usa callback/canceler em
`index.ts:164-188`, mas nao escuta `error`, remove listener e chama `kill()` sem
aguardar encerramento. Nenhum caminho possui os processos descendentes do shell.

1. **Referencia falha do RFC:** secao 10.1 (`MUST`: falhas operacionais permanecem tipadas), secao 10.4 (`MUST`: interrupcao permanece observavel; `SHOULD`: Promise adapter propaga o AbortSignal suportado), secao 12.1 (`MUST`: trabalho forkado possui owner que interrompe e aguarda), e secao 16.3 (`MUST`: callback/Promise/native resource e contido pelo adapter).
2. **Por que falhou:** exit de VCS e convertido em sucesso; `error` de spawn pode escapar do protocolo; Ctrl+C nao cancela `Effect.promise`; matar somente o shell/callback sem join nao comprova que processo e filhos terminaram.
3. **Possivel solucao:** usar `effect/unstable/process` e `ChildProcessSpawner` ja fornecido por `BunServices.layer`, com executable/args separados, sem shell; traduzir spawn/exit, interromper o handle no Scope e aguardar finalizacao. Recovery advisory de VCS deve ser explicito no owner.
4. **Ganhos esperados:** mensagem final reflete o resultado real e cancelamento nao deixa installs/repositorios rodando em background.
5. **Possiveis side effects:** falhas antes ocultas passam a erro/aviso; remover shell exige representar argumentos por plataforma e pode mudar lookup de executavel.

Criterio de aceite: spawner controlado cobre sucesso, exit nao zero, erro de
spawn e interrupcao; cada caso prova tag, sinal de cancelamento e processo
finalizado antes do CLI terminar.

#### EFFECT-061 - PR e publicacao nao verificam CLI nem templates

Severidade: **Alta**. Classe: **recomendacao concreta**.

Evidencias: scripts raiz limitam typecheck ao core e testes a core/www em
`package.json:20-37`; `typecheck:templates` existe, mas nao participa de
`typecheck`/`check`. `packages/cli/package.json:20-44` nao define script de teste.
Os workflows de PR, release e publish executam apenas os scripts raiz; o teste
de typecheck/build em `packages/cli/src/__tests__/scaffold.test.ts:266-300` cobre
somente `blank`, enquanto `incident` esta quebrado.

1. **Referencia falha do RFC:** secao 5.1, "Quality Verticals" (`SHOULD`: vertical critica identifica tests/checks que fornecem evidencia), e secao 19.4 (`SHOULD`: intent e afirmada por resultado publico/lifecycle).
2. **Por que falhou:** existe um comando capaz de encontrar o erro, mas nenhum gate de pacote/publicacao o chama. Mesmo apos corrigir Vitest do core, regressao em `create-trygg` pode ser publicada sem coleta, typecheck ou scaffold smoke.
3. **Possivel solucao:** adicionar scripts CLI; incluir typecheck CLI, `typecheck:templates` e suite CLI nos comandos raiz usados pelos workflows; executar smoke typecheck/build para cada template publicavel.
4. **Ganhos esperados:** um release de `create-trygg` so publica scaffolds instalaveis, compilaveis e construiveis.
5. **Possiveis side effects:** CI fica mais lenta; separar typecheck rapido de um job de scaffold/install com cache mantem feedback aceitavel.

Criterio de aceite: quebra proposital em qualquer template ou suite CLI reprova
o mesmo gate exigido por PR e publish.

#### EFFECT-062 - Schemas HTTP duplicados perdem a identidade dos erros canonicos

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: classes canonicas existem em
`packages/cli/templates/incident/app/errors/incidents.ts:20-34`, mas endpoints
criam novos `Schema.TaggedStruct` com as mesmas tags em
`app/api.ts:42-50,62-86`. O cliente decodifica objetos estruturais; UI usa
`instanceof` em `app/components/error-view.tsx:9-20` e
`app/pages/incident-detail.tsx:185-190`, portanto um 404 valido cai no erro
generico e oferece retry.

1. **Referencia falha do RFC:** secao 7.2, "Canonical Representations" (`SHOULD`: cada boundary possui um Schema canonico e um caminho canonico de transformacao), e secao 18.3, "Error Translation" (`SHOULD`: handlers traduzem tags concretas e preservam semantica).
2. **Por que falhou:** igualdade estrutural de `_tag` nao preserva prototype/identidade exigida pelo consumidor. Servidor produz classe, wire Schema reconstrui outro tipo e UI escolhe policy por `instanceof`.
3. **Possivel solucao:** usar as classes canonicas como Schemas dos endpoints ou uma transformacao canonica que decodifique para essas classes; alternativamente mudar toda a policy para discriminacao por tag, sem misturar os modelos.
4. **Ganhos esperados:** 404/422 recebem apresentacao e retry corretos e existe uma unica definicao de campos por erro.
5. **Possiveis side effects:** tipo decodificado passa de objeto simples para instancia de classe; JSON wire permanece equivalente, mas snapshots runtime mudam.

Criterio de aceite: cliente in-memory/HTTP recebe as classes ou discriminantes
canonicos e cada view seleciona a policy esperada para 404 e 422.

#### EFFECT-063 - Schemas de entrada aceitam IDs e titulos invalidos

Severidade: **Media**. Classe: **violacao normativa**.

Evidencias: `CreateIncident.title` usa `Schema.String` em
`packages/cli/templates/incident/app/api.ts:32-35`, embora o formulario rejeite
titulo em branco em `app/components/report-form.tsx:34-53`; o Service armazena o
valor sem outra validacao em `app/services/incidents.ts:128-141`. Params usam
`Schema.NumberFromString` sem refinamento em `app/api.ts:65-80` e
`app/routes.ts:21-23`; negativos, fracoes, nao finitos e IDs fora do dominio
atravessam o boundary. Com `Resource.hash`, IDs distintos ainda podem colidir
conforme EFFECT-024.

1. **Referencia falha do RFC:** secao 7.1 (`MUST`: dados transportados sao decodificados antes do dominio), secao 7.2 (`SHOULD`: um Schema canonico), e secao 21.1 (`MUST`: input invalido produz typed boundary failure).
2. **Por que falhou:** Schemas primitivas verificam apenas representacao superficial, nao os invariantes ja assumidos pelo formulario e pela identidade gerada no Service. O cliente pode persistir titulo vazio/whitespace e IDs impossiveis chegam ao cache/dominio como numeros validos no tipo.
3. **Possivel solucao:** definir `IncidentId` como inteiro seguro positivo e `IncidentTitle` com trim/non-empty/limite; reutilizar os mesmos Schemas em API, router e Service. Um codec temporal mais preciso ainda melhora o contrato de saida, mas nenhum timestamp nao confiavel entra pelos endpoints atuais.
4. **Ganhos esperados:** input invalido falha no primeiro boundary, cache usa identidade valida e o backend preserva o mesmo contrato de titulo apresentado pelo cliente.
5. **Possiveis side effects:** whitespace passa a ser normalizado ou rejeitado; clientes que enviam IDs numericos fora do dominio recebem falha de decoding em vez de 404.

Criterio de aceite: tabela de negativos, fracoes, nao finitos e titulos vazios ou
whitespace falha tipadamente; IDs inteiros positivos e titulos validos fazem
round-trip pelo endpoint correspondente.

#### EFFECT-064 - O estado do adapter `IncidentsLive` nasce fora da aquisicao do Layer

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `makeIncidentService` cria `Map` e `nextId` em
`packages/cli/templates/incident/app/services/incidents.ts:112-176`, mas
`IncidentsLive` chama a factory durante avaliacao do modulo com `Layer.succeed`
em `services/incidents.ts:178`. Aquisoes independentes do mesmo Layer reutilizam
o singleton mutado.

1. **Referencia falha do RFC:** secao 9.1, "Layer Construction" (`SHOULD`: estado mutavel do adapter e criado durante construcao do Layer), secao 9.3 (`SHOULD`: placement preserva identidade/lifetime/isolation), e secao 19.3 (`SHOULD`: mutable test Layers sao reconstruidos salvo sharing intencional).
2. **Por que falhou:** ownership e determinado pelo import do modulo, nao pela aquisicao. Estado vaza entre runtimes, testes e lifecycles que esperam stores independentes.
3. **Possivel solucao:** construir Service em `Layer.sync`/`Layer.effect`. Memoization do mesmo Layer preserva sharing dentro da aquisicao pretendida; aquisicoes independentes criam stores distintos. Considerar Ref/SynchronizedRef se mutacoes concorrentes fizerem parte do exemplo.
4. **Ganhos esperados:** identidade acompanha o Layer e testes/runtimes iniciam do seed declarado sem estado global residual.
5. **Possiveis side effects:** consumidores que dependiam acidentalmente do singleton de modulo deixam de compartilhar dados entre runtimes.

Criterio de aceite: duas aquisicoes independentes comecam no mesmo seed; dois
consumidores da mesma aquisicao observam a mesma mutacao.

#### EFFECT-065 - Scaffold falho ou interrompido deixa destino parcial e bloqueia retry

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `scaffoldProject` cria o target e copia/escreve arquivos
sequencialmente em `packages/cli/src/scaffold.ts:64-119`; nao ha staging nem
rollback. A verificacao de ausencia ocorre antes, em `packages/cli/index.ts:90-97`,
criando tambem uma race. Falha depois de copiar `app/` deixa target existente e
o proximo run e recusado por `DirectoryExistsError`.

1. **Referencia falha do RFC:** secao 5.1, "Quality Verticals" (`SHOULD`: garantia de consistencia identifica owner, enforcement e evidencia), secao 12.2, "Primitive Selection" (a primitive/protocolo determina atomicidade e ordering), e secao 5.2 (`SHOULD`: review decisions sao ligadas a failure mode concreto).
2. **Por que falhou:** durable output e publicado incrementalmente antes de o comando saber se consegue concluir. Nenhum owner distingue staging de resultado committed, e outro processo pode criar o destino entre check e escrita.
3. **Possivel solucao:** gerar em diretorio temporario irmao owned por Scope e publica-lo somente apos sucesso com uma operacao de filesystem que garanta atomicamente `no-replace`; `rename` simples so serve se o adapter/plataforma provar essa garantia. Caso contrario, usar reserva/lock project-owned que nunca sobrescreva o vencedor. Limpar staging em failure/interruption.
4. **Ganhos esperados:** comando e all-or-nothing para o usuario, retry funciona e criacao concorrente nunca e sobrescrita.
5. **Possiveis side effects:** testes que criam o target antecipadamente precisam usar path filho inexistente; staging deve ficar no mesmo filesystem para rename atomico.

Criterio de aceite: falha/interrupcao em cada etapa nao deixa target nem staging,
e corrida com outro criador retorna erro sem alterar o destino vencedor.

#### EFFECT-066 - O CLI classifica falhas externas como cancelamento ou `unknown`

Severidade: **Media**. Classe: **violacao normativa**.

Evidencias: `runPrompt` converte qualquer Promise rejeitada em
`PromptCancelledError` e trata select desconhecido igual em
`packages/cli/src/adapters/prompts-live.ts:21-29,71-78`. `copyDir` declara erro
`unknown` em `packages/cli/src/scaffold.ts:23-42`; o command root amplia a uniao
inteira para `unknown` em `packages/cli/index.ts:52-60`.

1. **Referencia falha do RFC:** secao 10.1 (`MUST`: falha external/operacional esperada permanece tipada ate tratamento deliberado), e secao 16.3 (`MUST`: Promise/protocol failure e traduzido para erro project-owned).
2. **Por que falhou:** cancelamento pelo usuario, falha do terminal, resposta invalida, filesystem e generator perdem operacao/tag antes do boundary terminal. O owner nao consegue escolher exit code, mensagem ou recovery corretos.
3. **Possivel solucao:** separar `PromptCancelledError`, `PromptFailedError` e `InvalidPromptResponseError`; preservar/mapear `PlatformError` e erros dos generators; remover widenings `unknown` e tratar tags no root.
4. **Ganhos esperados:** cancelamento continua silencioso/deliberado, enquanto falhas reais recebem diagnostico e exit code corretos.
5. **Possiveis side effects:** unions publicas crescem e o root precisa de handlers explicitos; mensagens existentes mudam.

Criterio de aceite: simbolo cancel, Promise rejeitada, valor desconhecido e erro
de filesystem produzem tags/Causes distintas ate o terminal.

#### EFFECT-067 - Cookie e APIs de tema transformam input/browser failures em defects

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: leitura/escrita de cookie chama getter, `decodeURIComponent` e setter
dentro de `Effect.sync` em
`packages/cli/templates/incident/app/services/theme.ts:54-78`; `matchMedia` e
listeners tambem sao declarados infaliveis em `theme.ts:80-127`. Cookie
`theme=%` produz `URIError`/Cause die durante aquisicao de `AppThemeDark`, embora o
Layer declare apenas `SignalScopeError`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.1 (`MUST`: falha external esperada permanece tipada), secao 16.3 (`MUST`: throw/native API e contido e traduzido), e secao 21.1 (`MUST`: stored input invalido produz boundary failure, nao reparo/cast silencioso).
2. **Por que falhou:** cookie e browser capability sao boundaries externos, mas `Effect.sync` transforma seus throws em defects. O tipo do Layer nao revela que estado persistido malformado ou `SecurityError` pode impedir mount.
3. **Possivel solucao:** decodificar `ThemePreference` por Schema; envolver getter/decoder/setter/matchMedia/register com `Effect.try` e erros proprios; no release scoped, capturar/reportar throws e terminar com erro `never`. Se fechamento tipado for parte do contrato, expo-lo separadamente. Decidir no composition root se tema faz fail-open com fallback observavel.
4. **Ganhos esperados:** startup pode recuperar ou diagnosticar dados invalidos sem Cause inesperada, e o contrato do Layer se torna verdadeiro.
5. **Possiveis side effects:** novos erros se propagam ou geram fallback explicito; ambientes restritos podem passar a mostrar diagnostico onde antes defectavam.

Criterio de aceite: cookie malformado, getter/setter que lanca, matchMedia ausente
e falha de listener seguem a policy tipada e cleanup continua exato.

### Evidencia e helpers de teste

#### EFFECT-068 - Doubles redefinem os ports e nenhum teste exercita os adapters live

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: todos os casos de storage fornecem apenas Maps independentes em
`packages/core/src/platform/__tests__/storage.test.ts:14-120`, portanto nao
atravessam o wiring live incorreto de EFFECT-002. O double DOM transforma
mutacoes, atributos, properties e selectors em no-op/constantes em
`packages/core/src/platform/dom.ts:350-383`; os testes afirmam explicitamente
esses no-ops em `packages/core/src/platform/__tests__/dom.test.ts:43-148`, em vez
do contrato de mutacao do adapter browser em `dom.ts:183-343`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 5.1, "Quality Verticals" (`SHOULD`: uma vertical critica identifica tests/checks que fornecem evidencia), e secao 19.3, "Adapter Conformance" (`SHOULD`: adapters do mesmo port executam os mesmos casos publicos).
2. **Por que falhou:** os doubles nao controlam apenas o browser; eles fornecem outra semantica para o proprio Service sob teste. Uma suite verde prova Maps/no-ops e nao prova wiring, mutacao, protocol failures ou equivalencia do adapter publicado.
3. **Possivel solucao:** definir casos de conformance publicos compartilhados; executa-los contra Layers controlados e live sob happy-dom, substituindo somente globals nativos. Fazer o double DOM preservar mutacoes observaveis ou remove-lo quando o browser adapter ja e controlavel.
4. **Ganhos esperados:** wiring de LocalStorage, mutacoes DOM, selectors e erros de boundary passam a ser cobertos pelo mesmo contrato consumido em producao.
5. **Possiveis side effects:** testes que dependem de no-op precisam de containers e cleanup isolados; adapters controlados passam a implementar mais comportamento real.

Criterio de aceite: uma unica tabela de casos roda contra cada adapter do port e
falha se LocalStorage tocar sessionStorage ou se mutacao DOM reportar sucesso sem
alterar o node.

#### EFFECT-069 - Scroll converte defects e interrupcao em `ignoredError`

Severidade: **Alta**. Classe: **recomendacao extrarrfc**.

Evidencias: toda a aplicacao de scroll termina em `Effect.catchCause` e retorna
sucesso `kind: "ignoredError"` em
`packages/core/src/router/service.ts:943-1021`. Os testes de Router usam somente
`Router.testLayer`, em `packages/core/src/router/__tests__/service.test.tsx:434-470`,
cujo `applyScroll` nao atravessa essa implementacao live.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.3, "Cause Handling" (`MUST`: recovery esperado opera no canal tipado; `MUST NOT`: `catchCause` transforma defect/interrupcao em fallback success), secao 10.4 (`MUST`: interrupcao permanece observavel), e secao 19.1 (`MUST`: teste usa o sujeito real).
2. **Por que falhou:** a intencao best-effort foi aplicada no nivel de Cause. Falha operacional prevista, bug em Scroll/DOM e cancelamento de uma navegacao recebem o mesmo outcome bem-sucedido, de modo que o owner nao pode interromper ou diagnosticar corretamente.
3. **Possivel solucao:** usar `catchCause`/`catchCauseIf`, inspecionar todos os reasons e recuperar somente uma Cause composta exclusivamente pelos `Fail` documentados, com policy explicita para multiplos failures. `Effect.catch`/`catchTags` isolados podem consumir o primeiro `Fail` de uma Cause mista em `rc.112`; qualquer `Die`/`Interrupt` exige `Effect.failCause(cause)`. Testar `doApplyScroll` pelo Layer browser com Scroll, Storage e Dom controlados.
4. **Ganhos esperados:** fallback best-effort permanece para falhas operacionais, enquanto shutdown/cancelamento e bugs continuam visiveis ao supervisor.
5. **Possiveis side effects:** defects antes ocultos passam a falhar a operacao de navegacao e exigem reporter terminal; a uniao de erros operacionais de scroll fica explicita.

Criterio de aceite: failure, die e interrupt de cada adapter produzem outcomes
distintos por Exit/Cause; somente a failure documentada resulta em
`ignoredError`.

#### EFFECT-070 - Cleanup pode parar no primeiro release e apagar sua `Cause`

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: cleanup de Fragment executa filhos em sequencia e captura toda Cause
somente ao redor do bloco em
`packages/core/src/primitives/render-fragment.ts:40-44`; Intrinsic faz o mesmo
para children, props e node em `render-intrinsic.ts:737-745`. O mount root ainda
engole a Cause inteira em `packages/core/src/primitives/renderer.ts:649-660`.
Se o primeiro release morre, os seguintes nao executam e `Scope.close` pode mesmo
assim terminar em sucesso. Os testes de cleanup em
`packages/core/src/primitives/__tests__/renderer.test.tsx:1135-1239` cobrem apenas
finalizers bem-sucedidos.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 10.3 (`MUST NOT`: Cause handling transforma defects/interruption em sucesso), secao 12.4 (`MUST`: todo recurso adquirido possui finalizer), e secao 19.5 (`MUST`: testes de lifecycle sincronizam e inspecionam a transicao relevante).
2. **Por que falhou:** um catch externo confunde "continuar limpando" com "ignorar a falha". A primeira Cause aborta o generator, pula releases restantes e depois e convertida em void, produzindo simultaneamente leak e falsa finalizacao bem-sucedida.
3. **Possivel solucao:** instalar recursos como finalizers independentes ou executar cada release com `ensuring`/composicao que preserve todas as tentativas; agregar/preservar a Cause ou envia-la uma vez a um reporter terminal sem substituir uma falha primaria.
4. **Ganhos esperados:** um cleanup defeituoso nao impede os demais e shutdown continua diagnosticavel.
5. **Possiveis side effects:** defects latentes de release passam a aparecer; Causes paralelas/agregadas exigem formatacao segura e policy para erro primario versus cleanup.

Criterio de aceite: falha injetada no primeiro child/prop ainda finaliza todos os
outros exatamente uma vez e o Exit final preserva ou reporta a Cause original.

#### EFFECT-071 - `type()` retorna antes dos handlers Effect que disparou

Severidade: **Media**. Classe: **recomendacao extrarrfc**.

Evidencias: `click` drena microtask e TestClock em
`packages/core/src/testing/index.ts:380-411`, mas `type` apenas despacha `input` e
`change` sincronos em `testing/index.ts:448-474`. A documentacao recomenda ambos
porque drenam o scheduler em `packages/core/src/testing/testing.docs.md:42,59-60`.
Os casos existentes usam somente listeners DOM sincronos em
`packages/core/src/testing/__tests__/testing.test.tsx:823-927`, nao um handler
Effect real do Renderer.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 19.1 (`MUST`: teste usa a implementacao real do sujeito), secao 19.4 (`SHOULD`: teste afirma intent por resultado publico), e secao 19.5 (`MUST`: sincronizacao explicita substitui sleeps/assumptions de scheduler).
2. **Por que falhou:** DOM dispatch retorna antes da Fiber criada pelo Renderer. A proxima assertion pode observar estado anterior mesmo depois de `yield* type`, contrariando o helper/documentacao e gerando testes flaky ou falsamente negativos.
3. **Possivel solucao:** aplicar `flushInteractionEffects` depois dos dois eventos, como `click`; cobrir com Component real cujo `onInput` cruza `yieldNow` ou coordena por `Deferred` antes de atualizar Signal/Ref.
4. **Ganhos esperados:** assertions imediatamente posteriores observam handlers e Signal updates settled conforme o contrato do helper.
5. **Possiveis side effects:** cada `type` consome um ciclo adicional do scheduler; trabalho externo longo ainda requer `Deferred`/`waitFor` explicito.

Criterio de aceite: handler Effect real que suspende uma vez termina antes de
`type()` retornar; operacoes deliberadamente longas continuam controlaveis por
sincronizacao explicita.

#### EFFECT-072 - O teste de fechamento de Signal e tautologico

Severidade: **Baixa**. Classe: **recomendacao extrarrfc**.

Evidencias: o teste "should stop all fibers" inicializa
`fiberStillRunning = true`, nunca dispara o listener antes de fechar o Scope, o
callback tambem apenas escreve `true` e a assertion espera `true` em
`packages/core/src/primitives/__tests__/signal.test.ts:1210-1232`.

1. **Referencia orientadora do RFC (analogia extrarrfc):** secao 19.4, "Intent and Interaction" (`SHOULD`: assertions descrevem o resultado publico/lifecycle), e secao 19.5 (`MUST`: testes concorrentes sincronizam no ponto relevante; `SHOULD`: inspecionam Exit/Cause quando a classificacao importa).
2. **Por que falhou:** qualquer implementacao passa, inclusive uma que nunca remove subscription. O nome afirma interrupcao de Fibers, mas `subscribe` apenas registra callback e o cenario nao cria Fiber em execucao.
3. **Possivel solucao:** se o contrato e unsubscribe, iniciar contador em zero, fechar, executar `Signal.set` e exigir zero chamadas; renomear o teste. Se callback em andamento deve ser interrompido, primeiro definir ownership na API e provar inicio/interruption com `Deferred` e `onInterrupt`.
4. **Ganhos esperados:** remove falsa evidencia e torna explicito se o contrato cobre apenas futura admissao ou tambem trabalho em andamento.
5. **Possiveis side effects:** escolher interruption de callback exige mudanca de runtime; corrigir apenas a assertion nao altera comportamento.

Criterio de aceite: o teste falha se unsubscribe for removido; qualquer claim de
Fiber usa uma Fiber realmente iniciada e observa sua interrupcao/finalizacao.

#### EFFECT-073 - O gate `check` falha antes de estabelecer a evidencia de lint

Severidade: **Media**. Classe: **recomendacao concreta**.

Evidencias: `package.json:32-37` inclui `lint:fix` no `check` exigido pelo PR em
`.github/workflows/pr.yml:33-34`. `bun run lint` retorna dois erros: JSX em arquivo
`.ts` em `packages/core/type-tests/spike-call/spike-call.ts:18` e a regra
`effect(no-unknown-runtime-requirements)` sobre `ComponentYieldable` em
`packages/core/src/primitives/component.ts:111`.

1. **Referencia falha do RFC:** secao 5.1, "Quality Verticals" (`SHOULD`: uma vertical critica identifica tests/checks que fornecem evidencia) e secao 5.2, "Requirement Strength" (`SHOULD`: reviewers ligam recomendacoes a um failure mode concreto, nao apenas a preferencia).
2. **Por que falhou:** o job obrigatorio sempre encerra com status 1, portanto nao estabelece a evidencia de lint que pretende exigir. O parse error tambem deixa aquele type fixture fora da analise; o segundo erro sinaliza um requirement `unknown`, mas esta revisao nao presume erasure de tipo sem uma reproducao separada.
3. **Possivel solucao:** mover o fixture JSX para `.tsx` ou representa-lo sem JSX; reestruturar a constraint generica para preservar `R` sem `unknown`, ou adicionar suppressao local justificada somente se um type test provar que a regra e falso positivo. Nao desabilitar a regra globalmente.
4. **Ganhos esperados:** `check` volta a ser um gate executavel e o fixture/constraint passam pelas regras que o repositorio escolheu como evidencia.
5. **Possiveis side effects:** renomear o fixture exige atualizar seu runner/path; alterar constraints pode mudar inferencia e deve manter os type tests de requirements verdes.

Criterio de aceite: `bun run lint` e `bun run check` saem 0, o fixture continua
provando propagacao de Service requirements e nenhuma suppressao global reduz a
cobertura Effect.

## Ordem de remediacao

| Onda | Achados | Objetivo |
| --- | --- | --- |
| 0 - Contencao | EFFECT-023, EFFECT-030 e EFFECT-031 | Corrigir corrupcao critica de lifecycle/identidade e bloquear os sinks URL exploraveis |
| 1 - Restaurar evidencia | EFFECT-001, EFFECT-059, EFFECT-061, EFFECT-068 e EFFECT-071 a EFFECT-073 | Fazer suites, templates, helpers e gates oficiais realmente executarem o sujeito publicado |
| 2 - Ownership e Cause | EFFECT-003 a EFFECT-014, EFFECT-025 a EFFECT-029, EFFECT-037 a EFFECT-040, EFFECT-043 a EFFECT-044, EFFECT-049 a EFFECT-057, EFFECT-060 e EFFECT-069 a EFFECT-070 | Estabelecer owners estruturais, shutdown aguardado, cancellation e classificacao fail/die/interrupt antes de corrigir sintomas locais |
| 3 - Contratos restantes | Demais achados | Unificar representacoes, validar configuracao/input, corrigir adapters/codegen e fechar observabilidade/cache/CLI |

As ondas combinam risco de produto e dependencia de correcao, nao forca
normativa; por isso a onda 0 contem riscos frontend criticos extrarrfc. Nenhuma
violacao normativa posterior e opcional. A ordem evita validar correcoes sobre um
runner quebrado ou construir novos fluxos sobre owners e Causes ainda incorretos.

## Observacoes sem achado

Nao foi demonstrada falha material adicional nas formas de Services da secao 8,
nos `Layer.mergeAll` dos composition roots ou na organizacao da secao 20.
`Signal.modify` preservou as operacoes concorrentes no probe que expos a falha de
`Signal.update`. O uso de tempo real encontrado em formatacao de apresentacao nao
foi tratado como relogio de dominio. Nenhuma regra de persistencia, durable
delivery, Workflow, Activity, migration ou Stream foi inferida sem a respectiva
precondicao.

As solucoes propostas foram verificadas contra a instalacao local de Effect
`4.0.0-rc.112`. Essa versao fornece `Effect.forkIn`, `FiberSet.make`/`runtime`/
`join`, `Scope.fork`, `Effect.failCause`, `Cause.hasDies`,
`Cause.hasInterrupts`, `ManagedRuntime.dispose`/`disposeEffect`, `Queue.sliding`,
`Layer.sync` e os Schemas temporais citados. `Fiber.runIn` retorna imediatamente,
mas seu finalizer faz `Scope.close` interromper e aguardar a Fiber; observacao de
falha durante a execucao ainda exige policy separada. `Effect.catch`/`catchTags`
podem recuperar o primeiro `Fail` de uma Cause mista, finalizers scoped exigem
erro `never` e descarte concorrente de `ManagedRuntime` precisa de single-flight
externo. O peer instalado de `@effect/vitest` exige Vitest `>=4.1.0 <5.0.0`.

## Limitacoes da evidencia

O runner oficial falhou antes da coleta, portanto este relatorio nao afirma que
as suites existentes passam. Os probes deterministas validam interleavings e
boundaries especificos, mas nao substituem uma execucao completa nem prova E2E
em browser real. Aplicacoes consumidoras em `apps/`, todo `scratch/` e capacidades
backend inexistentes permaneceram fora do escopo. O snapshot inclui o worktree
sujo identificado no inicio; linhas e resultados se referem a esse estado.

## Conclusao

A principal lacuna nao e preferencia de estilo Effect. O framework possui falhas
reproduziveis nos contratos que Effect deveria tornar explicitos: quem possui o
trabalho, quando um recurso termina, qual Cause atravessa o boundary, qual
representacao e authoritative e qual teste prova a garantia real. A revisao deve
ser repetida depois das ondas 0-2 com Vitest compativel e gates completos; ate
la, build/typecheck verdes nao compensam as 17 violacoes normativas aplicaveis.
