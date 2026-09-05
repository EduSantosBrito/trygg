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

const UserRepositoryBase = Layer.make<UserRepository, RepositoryInitError, HttpClient>({
  name: "UserRepositoryBase",
  outputs: [UserRepository],
  inputs: [HttpClient],
  errors: [RepositoryInitError],
});

const ProfileCard = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", { className: "card" });
});

const ProfilePage = gen(function* () {
  return <ProfileCard />;
});

const ProvidedProfilePage = provide(UserRepositoryBase)(ProfilePage);

const App = gen(function* () {
  return <ProvidedProfilePage />;
});

export function bootstrap(): void {
  mount(null, <App />);
}
