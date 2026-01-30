import { Effect, Layer, Option } from "effect";
import { Signal, Component, cx } from "trygg";
import { TodoTheme } from "../services/todo";
import { TodoInput } from "../components/todo/todo-input";
import { FilterButton } from "../components/todo/filter-button";

interface Todo {
  readonly id: number;
  readonly text: string;
  readonly completed: boolean;
}

type Filter = "all" | "active" | "completed";

const defaultTodoTheme = Layer.succeed(TodoTheme, {
  completedColor: "#888",
  activeColor: "#333",
  dangerColor: "#dc3545",
  primaryColor: "#0066cc",
});

const ProvidedTodoInput = TodoInput.provide(defaultTodoTheme);
const ProvidedFilterButton = FilterButton.provide(defaultTodoTheme);

const TodoPage = Component.gen(function* () {
  const todos = yield* Signal.make<ReadonlyArray<Todo>>([]);
  const inputValue = yield* Signal.make("");
  const filter = yield* Signal.make<Filter>("all");
  const nextId = yield* Signal.make(1);

  const filterValue = yield* Signal.get(filter);
  const todosValue = yield* Signal.get(todos);

  const filteredTodos = yield* Signal.derive(
    todos,
    (list): ReadonlyArray<Todo> =>
      list.filter((todo) => {
        if (filterValue === "active") return !todo.completed;
        if (filterValue === "completed") return todo.completed;
        return true;
      }),
  );

  const addTodo = () =>
    Effect.gen(function* () {
      const text = (yield* Signal.get(inputValue)).trim();
      if (text === "") return;

      const id = yield* Signal.get(nextId);
      yield* Signal.update(todos, (list) => [...list, { id, text, completed: false }]);
      yield* Signal.update(nextId, (n) => n + 1);
      yield* Signal.set(inputValue, "");
    });

  const toggleTodo = (id: number) =>
    Signal.update(todos, (list) =>
      list.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    );

  const updateTodoText = (id: number, text: string) =>
    Signal.update(todos, (list) => list.map((todo) => (todo.id === id ? { ...todo, text } : todo)));

  const removeTodo = (id: number) =>
    Signal.update(todos, (list) => list.filter((todo) => todo.id !== id));

  const onInputChange = (e: Event) =>
    Effect.sync(() => {
      const target = e.target;
      if (target instanceof HTMLInputElement) {
        return target.value;
      }
      return "";
    }).pipe(Effect.flatMap((v) => Signal.set(inputValue, v)));

  const activeCount = todosValue.filter((t) => !t.completed).length;
  const completedCount = todosValue.filter((t) => t.completed).length;

  const todoListElement = Signal.each(
    filteredTodos,
    (todo) =>
      Effect.gen(function* () {
        const editText = yield* Signal.make<Option.Option<string>>(Option.none());
        const editTextValue = yield* Signal.get(editText);
        const isEditing = Option.isSome(editTextValue);

        const startEditing = () => Signal.set(editText, Option.some(todo.text));
        const cancelEditing = () => Signal.set(editText, Option.none());

        const saveEditing = () =>
          Effect.gen(function* () {
            const text = yield* Signal.get(editText);
            if (Option.isSome(text) && text.value.trim() !== "") {
              yield* updateTodoText(todo.id, text.value.trim());
            }
            yield* Signal.set(editText, Option.none());
          });

        const onEditInputChange = (e: Event) =>
          Effect.sync(() => {
            const target = e.target;
            if (target instanceof HTMLInputElement) {
              return target.value;
            }
            return "";
          }).pipe(Effect.flatMap((v) => Signal.set(editText, Option.some(v))));

        const onEditKeyDown = (e: Event) =>
          Effect.gen(function* () {
            if (e instanceof KeyboardEvent) {
              if (e.key === "Enter") {
                yield* saveEditing();
              } else if (e.key === "Escape") {
                yield* cancelEditing();
              }
            }
          });

        return (
          <li
            key={todo.id}
            className={cx(
              "flex items-center gap-2 p-2 border-b border-gray-100",
              todo.completed && "line-through text-gray-400",
            )}
          >
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
              disabled={isEditing}
            />
            {isEditing ? (
              <input
                type="text"
                className="py-2 px-2 text-base border border-gray-300 rounded w-full focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                value={Option.isSome(editTextValue) ? editTextValue.value : ""}
                onInput={onEditInputChange}
                onKeyDown={onEditKeyDown}
                onBlur={() => saveEditing()}
                autoFocus={true}
              />
            ) : (
              <>
                <span className="flex-1" onDblclick={() => startEditing()}>
                  {todo.text}
                </span>
                <button
                  className="px-4 py-2 text-base border rounded cursor-pointer transition-colors bg-red-600 border-red-600 text-white hover:bg-red-700"
                  onClick={() => removeTodo(todo.id)}
                >
                  Delete
                </button>
              </>
            )}
          </li>
        );
      }),
    { key: (todo) => todo.id },
  );

  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <h2>Todo List</h2>
      <p className="description">
        Double-click a todo to edit. Try adding/removing todos while editing - the edit state
        persists!
      </p>

      <ProvidedTodoInput value={inputValue} onSubmit={addTodo} onInput={onInputChange} />

      <ul className="list-none p-0">{todoListElement}</ul>

      {todosValue.length > 0 && (
        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
          <ProvidedFilterButton
            label="All"
            count={todosValue.length}
            isActive={filterValue === "all"}
            onClick={() => Signal.set(filter, "all")}
          />
          <ProvidedFilterButton
            label="Active"
            count={activeCount}
            isActive={filterValue === "active"}
            onClick={() => Signal.set(filter, "active")}
          />
          <ProvidedFilterButton
            label="Completed"
            count={completedCount}
            isActive={filterValue === "completed"}
            onClick={() => Signal.set(filter, "completed")}
          />
        </div>
      )}

      {todosValue.length === 0 && (
        <p className="text-gray-400 text-center">No todos yet. Add one above!</p>
      )}
    </div>
  );
});

export default TodoPage;
