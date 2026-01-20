/**
 * Todo List Example
 *
 * Demonstrates:
 * - Component.gen for reusable components with services
 * - Signal.each for efficient list rendering with stable scopes
 * - Nested state per item (editing mode) that persists across list changes
 * - Fine-grained reactivity with Signal objects
 * - List operations (add, remove, toggle)
 */
import { Context, Effect, Layer, Option } from "effect"
import { Signal, Component, type ComponentProps } from "effect-ui"

// =============================================================================
// Types
// =============================================================================

interface Todo {
  readonly id: number
  readonly text: string
  readonly completed: boolean
}

type Filter = "all" | "active" | "completed"

// =============================================================================
// Todo Theme Service
// =============================================================================

interface TodoThemeConfig {
  readonly completedColor: string
  readonly activeColor: string
  readonly dangerColor: string
  readonly primaryColor: string
}

class TodoTheme extends Context.Tag("TodoTheme")<TodoTheme, TodoThemeConfig>() {}

const defaultTodoTheme = Layer.succeed(TodoTheme, {
  completedColor: "#888",
  activeColor: "#333",
  dangerColor: "#dc3545",
  primaryColor: "#0066cc"
})

// =============================================================================
// Components using Component.gen
// =============================================================================

// TodoInput component
const TodoInput = Component.gen(function* (Props: ComponentProps<{
  value: Signal.Signal<string>
  onSubmit: () => Effect.Effect<void>
  onInput: (e: Event) => Effect.Effect<void>
}>) {
  const { value, onSubmit, onInput } = yield* Props
  const theme = yield* TodoTheme
  
  const handleSubmit = (e: Event) =>
    Effect.sync(() => e.preventDefault()).pipe(Effect.flatMap(() => onSubmit()))

  return (
    <form onSubmit={handleSubmit}>
      <div className="todo-input">
        <input
          type="text"
          value={value}
          onInput={onInput}
          placeholder="What needs to be done?"
        />
        <button type="submit" style={{ background: theme.primaryColor, color: "white" }}>
          Add
        </button>
      </div>
    </form>
  )
})

// FilterButton component
const FilterButton = Component.gen(function* (Props: ComponentProps<{
  label: string
  count: number
  isActive: boolean
  onClick: () => Effect.Effect<void>
}>) {
  const { label, count, isActive, onClick } = yield* Props
  const theme = yield* TodoTheme
  
  return (
    <button
      className={isActive ? "primary" : ""}
      style={isActive ? { background: theme.primaryColor, color: "white" } : {}}
      onClick={onClick}
    >
      {label} ({count})
    </button>
  )
})

// =============================================================================
// Main Todo App
// =============================================================================

const TodoApp = Component.gen(function* () {
  // Create signals for state
  const todos = yield* Signal.make<ReadonlyArray<Todo>>([])
  const inputValue = yield* Signal.make("")
  const filter = yield* Signal.make<Filter>("all")
  const nextId = yield* Signal.make(1)

  // Read filter and todos for re-rendering
  const filterValue = yield* Signal.get(filter)
  const todosValue = yield* Signal.get(todos)

  // Derive a filtered signal
  const filteredTodos = yield* Signal.derive(todos, (list): ReadonlyArray<Todo> =>
    list.filter((todo) => {
      if (filterValue === "active") return !todo.completed
      if (filterValue === "completed") return todo.completed
      return true
    })
  )

  // Actions
  const addTodo = () =>
    Effect.gen(function* () {
      const text = (yield* Signal.get(inputValue)).trim()
      if (text === "") return

      const id = yield* Signal.get(nextId)
      yield* Signal.update(todos, (list) => [...list, { id, text, completed: false }])
      yield* Signal.update(nextId, (n) => n + 1)
      yield* Signal.set(inputValue, "")
    })

  const toggleTodo = (id: number) =>
    Signal.update(todos, (list) =>
      list.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    )

  const updateTodoText = (id: number, text: string) =>
    Signal.update(todos, (list) =>
      list.map((todo) =>
        todo.id === id ? { ...todo, text } : todo
      )
    )

  const removeTodo = (id: number) =>
    Signal.update(todos, (list) => list.filter((todo) => todo.id !== id))

  const onInputChange = (e: Event) =>
    Effect.sync(() => {
      const target = e.target
      if (target instanceof HTMLInputElement) {
        return target.value
      }
      return ""
    }).pipe(Effect.flatMap((v) => Signal.set(inputValue, v)))

  // Stats
  const activeCount = todosValue.filter((t) => !t.completed).length
  const completedCount = todosValue.filter((t) => t.completed).length

  // Use Signal.each for efficient list rendering
  const todoListElement = Signal.each(
    filteredTodos,
    (todo) =>
      Effect.gen(function* () {
        // Nested signal - stable per todo.id!
        const editText = yield* Signal.make<Option.Option<string>>(Option.none())
        const editTextValue = yield* Signal.get(editText)
        const isEditing = Option.isSome(editTextValue)

        const startEditing = () => Signal.set(editText, Option.some(todo.text))
        const cancelEditing = () => Signal.set(editText, Option.none())
        
        const saveEditing = () =>
          Effect.gen(function* () {
            const text = yield* Signal.get(editText)
            if (Option.isSome(text) && text.value.trim() !== "") {
              yield* updateTodoText(todo.id, text.value.trim())
            }
            yield* Signal.set(editText, Option.none())
          })

        const onEditInputChange = (e: Event) =>
          Effect.sync(() => {
            const target = e.target
            if (target instanceof HTMLInputElement) {
              return target.value
            }
            return ""
          }).pipe(Effect.flatMap((v) => Signal.set(editText, Option.some(v))))

        const onEditKeyDown = (e: Event) =>
          Effect.gen(function* () {
            if (e instanceof KeyboardEvent) {
              if (e.key === "Enter") {
                yield* saveEditing()
              } else if (e.key === "Escape") {
                yield* cancelEditing()
              }
            }
          })

        return (
          <li
            key={todo.id}
            className={todo.completed ? "todo-item completed" : "todo-item"}
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
                className="edit-input"
                value={Option.isSome(editTextValue) ? editTextValue.value : ""}
                onInput={onEditInputChange}
                onKeyDown={onEditKeyDown}
                onBlur={() => saveEditing()}
                autoFocus={true}
              />
            ) : (
              <>
                <span onDblclick={() => startEditing()}>{todo.text}</span>
                <button className="danger" onClick={() => removeTodo(todo.id)}>
                  Delete
                </button>
              </>
            )}
          </li>
        )
      }),
    { key: (todo) => todo.id }
  )

  return (
    <div className="example">
      <h2>Todo List</h2>
      <p className="description">
        Double-click a todo to edit. Try adding/removing todos while editing - the edit state persists!
      </p>
      
      <TodoInput
        value={inputValue}
        onSubmit={addTodo}
        onInput={onInputChange}
        todoTheme={defaultTodoTheme}
      />

      <ul className="todo-list">
        {todoListElement}
      </ul>

      {todosValue.length > 0 && (
        <div className="todo-filters">
          <FilterButton
            label="All"
            count={todosValue.length}
            isActive={filterValue === "all"}
            onClick={() => Signal.set(filter, "all")}
            todoTheme={defaultTodoTheme}
          />
          <FilterButton
            label="Active"
            count={activeCount}
            isActive={filterValue === "active"}
            onClick={() => Signal.set(filter, "active")}
            todoTheme={defaultTodoTheme}
          />
          <FilterButton
            label="Completed"
            count={completedCount}
            isActive={filterValue === "completed"}
            onClick={() => Signal.set(filter, "completed")}
            todoTheme={defaultTodoTheme}
          />
        </div>
      )}

      {todosValue.length === 0 && (
        <p style={{ color: "#999", textAlign: "center" }}>
          No todos yet. Add one above!
        </p>
      )}
      
      <div className="code-example">
        <h3>Signal.each for Lists</h3>
        <pre>{`// Efficient list rendering with stable nested state
const todoList = Signal.each(
  todos,
  (todo) => Effect.gen(function* () {
    // Nested signal - stable per todo.id!
    const editText = yield* Signal.make(Option.none())
    const isEditing = Option.isSome(yield* Signal.get(editText))
    
    return (
      <li key={todo.id}>
        {isEditing ? <input ... /> : <span>{todo.text}</span>}
      </li>
    )
  }),
  { key: (todo) => todo.id }
)`}</pre>
      </div>
    </div>
  )
})

export default TodoApp
