import { Element, gen, jsx, mount, RequiresService, UserRepository } from "../jsx-runtime.js";

const ProfileCard = gen(function* (): Generator<RequiresService<UserRepository>, Element, never> {
  void (yield [new UserRepository()] as never);
  return jsx("div", { className: "card" });
});

const ProfilePage = gen(function* () {
  return <ProfileCard />;
});

const App = gen(function* () {
  return <ProfilePage />;
});

export function bootstrap(): void {
  mount(null, <App />);
}
