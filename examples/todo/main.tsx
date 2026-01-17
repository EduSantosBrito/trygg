/**
 * Todo List Example
 *
 * Demonstrates:
 * - Signal.each for efficient list rendering with stable scopes
 * - Nested state per item (editing mode) that persists across list changes
 * - Fine-grained reactivity with Signal objects
 * - List operations (add, remove, toggle)
 * - DevMode for debug observability
 */
import { Effect, Option } from "effect"
import { mount, Signal, DevMode } from "effect-ui"

// Todo item type
interface Todo {
  readonly id: number
  readonly text: string
  readonly completed: boolean
}

// Filter type
type Filter = "all" | "active" | "completed"

// Main Todo app component
const TodoApp = Effect.gen(function* () {
  // Create signals for state
  const todos = yield* Signal.make<ReadonlyArray<Todo>>([])
  const inputValue = yield* Signal.make("")  // Don't read this - pass directly to input
  const filter = yield* Signal.make<Filter>("all")
  const nextId = yield* Signal.make(1)

  // Read filter for re-rendering on filter change
  const filterValue = yield* Signal.get(filter)
  
  // Read todos for stats (could be derived)
  const todosValue = yield* Signal.get(todos)

  // Derive a filtered signal
  const filteredTodos = yield* Signal.derive(todos, (list): ReadonlyArray<Todo> =>
    list.filter((todo) => {
      if (filterValue === "active") return !todo.completed
      if (filterValue === "completed") return todo.completed
      return true
    })
  )

  // Add a new todo
  const addTodo = () =>
    Effect.gen(function* () {
      const text = (yield* Signal.get(inputValue)).trim()
      if (text === "") return

      const id = yield* Signal.get(nextId)
      yield* Signal.update(todos, (list) => [...list, { id, text, completed: false }])
      yield* Signal.update(nextId, (n) => n + 1)
      yield* Signal.set(inputValue, "")
    })

  // Toggle todo completion
  const toggleTodo = (id: number) =>
    Signal.update(todos, (list) =>
      list.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    )

  // Update todo text
  const updateTodoText = (id: number, text: string) =>
    Signal.update(todos, (list) =>
      list.map((todo) =>
        todo.id === id ? { ...todo, text } : todo
      )
    )

  // Remove a todo
  const removeTodo = (id: number) =>
    Signal.update(todos, (list) => list.filter((todo) => todo.id !== id))

  // Handle input change
  const onInputChange = (e: Event) =>
    Effect.sync(() => {
      const target = e.target
      if (target instanceof HTMLInputElement) {
        return target.value
      }
      return ""
    }).pipe(Effect.flatMap((v) => Signal.set(inputValue, v)))

  // Handle form submit
  const onSubmit = (e: Event) =>
    Effect.sync(() => e.preventDefault()).pipe(Effect.flatMap(() => addTodo()))

  // Count stats
  const activeCount = todosValue.filter((t) => !t.completed).length
  const completedCount = todosValue.filter((t) => t.completed).length

  // Use Signal.each for efficient list rendering
  // Each item gets a stable scope - nested signals persist across list changes!
  const todoListElement = Signal.each(
    filteredTodos,
    (todo) =>
      Effect.gen(function* () {
        // Nested signal - stable per todo.id! Persists when other todos change.
        const editText = yield* Signal.make<Option.Option<string>>(Option.none())
        
        // Read to trigger re-render when editing state changes
        const editTextValue = yield* Signal.get(editText)
        const isEditing = Option.isSome(editTextValue)

        // Start editing
        const startEditing = () => Signal.set(editText, Option.some(todo.text))
        
        // Cancel editing
        const cancelEditing = () => Signal.set(editText, Option.none())
        
        // Save editing
        const saveEditing = () =>
          Effect.gen(function* () {
            const text = yield* Signal.get(editText)
            if (Option.isSome(text) && text.value.trim() !== "") {
              yield* updateTodoText(todo.id, text.value.trim())
            }
            yield* Signal.set(editText, Option.none())
          })

        // Handle edit input change
        const onEditInputChange = (e: Event) =>
          Effect.sync(() => {
            const target = e.target
            if (target instanceof HTMLInputElement) {
              return target.value
            }
            return ""
          }).pipe(Effect.flatMap((v) => Signal.set(editText, Option.some(v))))

        // Handle key press in edit input
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
              <>
                <input
                  type="text"
                  className="edit-input"
                  value={Option.isSome(editTextValue) ? editTextValue.value : ""}
                  onInput={onEditInputChange}
                  onKeyDown={onEditKeyDown}
                  onBlur={() => saveEditing()}
                  autoFocus={true}
                />
              </>
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
      <h2>Todo List with Signal.each</h2>
      <p style={{ fontSize: "0.9em", color: "#666", marginBottom: "1em" }}>
        Double-click a todo to edit. Try adding/removing todos while editing - the edit state persists!
      </p>
      
      <form onSubmit={onSubmit}>
        <div className="todo-input">
          <input
            type="text"
            value={inputValue}
            onInput={onInputChange}
            placeholder="What needs to be done?"
          />
          <button type="submit" className="primary">
            Add
          </button>
        </div>
      </form>

      <ul className="todo-list">
        {todoListElement}
      </ul>

      {todosValue.length > 0 && (
        <div className="todo-filters">
          <button
            className={filterValue === "all" ? "primary" : ""}
            onClick={() => Signal.set(filter, "all")}
          >
            All ({todosValue.length})
          </button>
          <button
            className={filterValue === "active" ? "primary" : ""}
            onClick={() => Signal.set(filter, "active")}
          >
            Active ({activeCount})
          </button>
          <button
            className={filterValue === "completed" ? "primary" : ""}
            onClick={() => Signal.set(filter, "completed")}
          >
            Completed ({completedCount})
          </button>
        </div>
      )}

      {todosValue.length === 0 && (
        <p style={{ color: "#999", textAlign: "center" }}>
          No todos yet. Add one above!
        </p>
      )}
    </div>
  )
})

// Mount the app with DevMode for debug observability
const container = document.getElementById("root")
if (container) {
  mount(container, <>
    {TodoApp}
    <DevMode />
  </>)
}
