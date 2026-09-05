/**
 * MATRIZ DE TESTES — cada bloco usa @ts-expect-error como oráculo.
 * Se a diretiva aparecer como "unused" no tsc => o ERRO NÃO ocorreu
 * => o requisito foi silenciosamente descartado (falsa segurança).
 */
import {
  ComponentType,
  Element,
  gen,
  jsx,
  Layer,
  mount,
  provide,
  RequiresService,
  UserRepository,
} from "./jsx-runtime.js";

// Componente folha que exige UserRepository (via yield, como no trygg real)
const InnerCard = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", null);
});

// ---------------------------------------------------------------------------
// CASO 1 — uso explícito de jsx(): baseline que JÁ funciona hoje
// Deve ERROAR no mount (diretiva usada).
// ---------------------------------------------------------------------------
{
  const el = jsx(InnerCard, null);
  // @ts-expect-error CASO 1: requisito pendente deve ser rejeitado pelo mount
  mount(null, el);
}

// ---------------------------------------------------------------------------
// CASO 2 — sintaxe JSX pura: o problema central.
// Se a diretiva ficar UNUSED => R apagado => falsa segurança confirmada.
// ---------------------------------------------------------------------------
{
  const el = <InnerCard />;
  // @ts-expect-error CASO 2: esperado falhar SE o TypeScript preservasse R
  mount(null, el);
}

// ---------------------------------------------------------------------------
// CASO 3 — convenção NATIVA "chame, não etiquete":
// composição interna por chamada direta + consumo final por chamada direta.
// Se a diretiva for USADA => solução 100% nativa existe (com custo de DX).
// ---------------------------------------------------------------------------
{
  const ViaCall = gen(function* (): Generator<unknown, ReturnType<typeof InnerCard>, never> {
    return InnerCard({});
  });
  // @ts-expect-error CASO 3: encadeamento por chamadas deve preservar R até o mount
  mount(null, ViaCall({}));
}

// ---------------------------------------------------------------------------
// CASO 4 — armadilha da convenção: chamada DENTRO, mas JSX FORA.
// Mostra que a convenção precisa valer em TODOS os pontos de uso.
// Se a diretiva ficar UNUSED => a falsa segurança volta na borda externa.
// ---------------------------------------------------------------------------
{
  const ViaCall = gen(function* (): Generator<unknown, ReturnType<typeof InnerCard>, never> {
    return InnerCard({});
  });
  // @ts-expect-error CASO 4: mesmo com chamada interna, o JSX externo apaga R
  mount(null, <ViaCall />);
}

// ---------------------------------------------------------------------------
// CASO 5 — controle de falso positivo: serviço PROVIDO não pode erroar,
// nem no tsc cru nem sob o mini-check.
// ---------------------------------------------------------------------------
{
  const LayerFake = Layer.make<UserRepository>({
    name: "UserRepositoryLive",
    outputs: [UserRepository],
    inputs: [],
    errors: [],
  });
  const FixedCard = provide(LayerFake)(InnerCard);
  const el = <FixedCard />;
  mount(null, el); // NENHUMA diretiva aqui: deve passar limpo
}

// Tipos auxiliares apenas para não reclamar de import não usado
export type _Keep = [ComponentType, Element, UserRepository];
