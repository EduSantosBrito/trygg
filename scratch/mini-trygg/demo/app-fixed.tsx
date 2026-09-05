import {
  Element,
  gen,
  HttpClient,
  jsx,
  Layer,
  mount,
  provide,
  RepositoryInitError,
  RequiresService,
  UserRepository,
} from "../jsx-runtime.js";

const HttpClientLive = Layer.make<HttpClient>({
  name: "HttpClientLive",
  outputs: [HttpClient],
  inputs: [],
  errors: [],
});

const UserRepositoryBase = Layer.make<UserRepository, RepositoryInitError, HttpClient>({
  name: "UserRepositoryBase",
  outputs: [UserRepository],
  inputs: [HttpClient],
  errors: [RepositoryInitError],
});

const UserRepositoryLive = Layer.provide(HttpClientLive)(UserRepositoryBase);

const ProfileCard = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", { className: "card" });
});

const ProfilePage = gen(function* () {
  return <ProfileCard />;
});

const ProvidedProfilePage = provide(UserRepositoryLive)(ProfilePage);

const App = gen(function* () {
  return <ProvidedProfilePage />;
});

export function bootstrap(): void {
  mount(null, <App />);
}
