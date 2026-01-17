/**
 * KeyedList / Signal.each Tests
 *
 * Tests for efficient list rendering with stable scopes per key.
 * Verifies that:
 * - Lists render correctly
 * - Items maintain identity across updates
 * - Nested signals are preserved when list changes
 * - Items are properly added/removed
 */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Signal from "../src/Signal.js"
import { render, click, waitFor } from "../src/testing.js"

interface Todo {
  readonly id: number
  readonly text: string
  readonly completed: boolean
}

/**
 * Simple list component using Signal.each
 */
const SimpleList = Effect.gen(function* () {
  const items = yield* Signal.make<ReadonlyArray<{ id: number; name: string }>>([
    { id: 1, name: "Item 1" },
    { id: 2, name: "Item 2" },
    { id: 3, name: "Item 3" }
  ])

  const addItem = () =>
    Signal.update(items, (list) => [...list, { id: list.length + 1, name: `Item ${list.length + 1}` }])

  const removeItem = (id: number) =>
    Signal.update(items, (list) => list.filter((item) => item.id !== id))

  const listElement = Signal.each(
    items,
    (item) =>
      Effect.succeed(
        <li key={item.id} data-testid={`item-${item.id}`}>
          {item.name}
          <button
            data-testid={`remove-${item.id}`}
            onClick={() => removeItem(item.id)}
          >
            Remove
          </button>
        </li>
      ),
    { key: (item) => item.id }
  )

  return (
    <div data-testid="list-container">
      <ul data-testid="list">{listElement}</ul>
      <button data-testid="add" onClick={addItem}>
        Add Item
      </button>
    </div>
  )
})

/**
 * List with nested signal state per item
 * This tests that nested signals are preserved across list updates
 */
const ListWithNestedState = Effect.gen(function* () {
  const todos = yield* Signal.make<ReadonlyArray<Todo>>([
    { id: 1, text: "Todo 1", completed: false },
    { id: 2, text: "Todo 2", completed: false }
  ])

  const addTodo = () =>
    Signal.update(todos, (list) => [
      ...list,
      { id: list.length + 1, text: `Todo ${list.length + 1}`, completed: false }
    ])

  const removeTodo = (id: number) =>
    Signal.update(todos, (list) => list.filter((t) => t.id !== id))

  const listElement = Signal.each(
    todos,
    (todo) =>
      Effect.gen(function* () {
        // This nested signal should persist across list updates!
        const editing = yield* Signal.make(false)

        const toggleEditing = () => Signal.update(editing, (e) => !e)

        // Read editing state - this will trigger re-render of just this item
        const isEditing = yield* Signal.get(editing)

        return (
          <li key={todo.id} data-testid={`todo-${todo.id}`}>
            {isEditing ? (
              <input
                data-testid={`edit-input-${todo.id}`}
                value={todo.text}
                type="text"
              />
            ) : (
              <span data-testid={`text-${todo.id}`}>{todo.text}</span>
            )}
            <button data-testid={`toggle-edit-${todo.id}`} onClick={toggleEditing}>
              {isEditing ? "Save" : "Edit"}
            </button>
            <button
              data-testid={`remove-${todo.id}`}
              onClick={() => removeTodo(todo.id)}
            >
              Remove
            </button>
          </li>
        )
      }),
    { key: (todo) => todo.id }
  )

  return (
    <div data-testid="todo-container">
      <ul data-testid="todo-list">{listElement}</ul>
      <button data-testid="add-todo" onClick={addTodo}>
        Add Todo
      </button>
    </div>
  )
})

describe("Signal.each - Basic List Rendering", () => {
  it.scoped("renders initial list items", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(SimpleList)

      const list = getByTestId("list")
      expect(list).toBeDefined()

      // Check all items are rendered
      expect(getByTestId("item-1").textContent).toContain("Item 1")
      expect(getByTestId("item-2").textContent).toContain("Item 2")
      expect(getByTestId("item-3").textContent).toContain("Item 3")
    })
  )

  it.scoped("adds new items to the list", () =>
    Effect.gen(function* () {
      const { getByTestId, queryByTestId } = yield* render(SimpleList)

      // Initially no item 4
      expect(queryByTestId("item-4")).toBeNull()

      // Click add button
      yield* click(getByTestId("add"))

      // Wait for item 4 to appear
      yield* waitFor(() => {
        expect(getByTestId("item-4").textContent).toContain("Item 4")
        return true
      })
    })
  )

  it.scoped("removes items from the list", () =>
    Effect.gen(function* () {
      const { getByTestId, queryByTestId } = yield* render(SimpleList)

      // Item 2 exists
      expect(getByTestId("item-2")).toBeDefined()

      // Click remove for item 2
      yield* click(getByTestId("remove-2"))

      // Wait for item 2 to be removed
      yield* waitFor(() => {
        expect(queryByTestId("item-2")).toBeNull()
        return true
      })

      // Other items should still exist
      expect(getByTestId("item-1")).toBeDefined()
      expect(getByTestId("item-3")).toBeDefined()
    })
  )
})

describe("Signal.each - Nested State Preservation", () => {
  it.scoped("renders todos with edit/view modes", () =>
    Effect.gen(function* () {
      const { getByTestId } = yield* render(ListWithNestedState)

      // Initial state - viewing mode (not editing)
      expect(getByTestId("text-1").textContent).toBe("Todo 1")
      expect(getByTestId("text-2").textContent).toBe("Todo 2")
    })
  )

  it.scoped("toggles editing mode for individual items", () =>
    Effect.gen(function* () {
      const { getByTestId, queryByTestId } = yield* render(ListWithNestedState)

      // Initially in view mode
      expect(getByTestId("text-1")).toBeDefined()
      expect(queryByTestId("edit-input-1")).toBeNull()

      // Toggle editing for item 1
      yield* click(getByTestId("toggle-edit-1"))

      // Wait for edit mode
      yield* waitFor(() => {
        expect(queryByTestId("text-1")).toBeNull()
        expect(getByTestId("edit-input-1")).toBeDefined()
        return true
      })

      // Item 2 should still be in view mode
      expect(getByTestId("text-2")).toBeDefined()
    })
  )

  it.scoped("preserves editing state when adding new items", () =>
    Effect.gen(function* () {
      const { getByTestId, queryByTestId } = yield* render(ListWithNestedState)

      // Put item 1 in editing mode
      yield* click(getByTestId("toggle-edit-1"))
      yield* waitFor(() => {
        expect(getByTestId("edit-input-1")).toBeDefined()
        return true
      })

      // Add a new todo
      yield* click(getByTestId("add-todo"))

      // Wait for new todo to appear
      yield* waitFor(() => {
        expect(getByTestId("todo-3")).toBeDefined()
        return true
      })

      // Item 1 should STILL be in editing mode (state preserved!)
      expect(getByTestId("edit-input-1")).toBeDefined()
      expect(queryByTestId("text-1")).toBeNull()

      // New item should be in view mode
      expect(getByTestId("text-3")).toBeDefined()
    })
  )

  it.scoped("preserves editing state when removing other items", () =>
    Effect.gen(function* () {
      const { getByTestId, queryByTestId } = yield* render(ListWithNestedState)

      // Put item 2 in editing mode
      yield* click(getByTestId("toggle-edit-2"))
      yield* waitFor(() => {
        expect(getByTestId("edit-input-2")).toBeDefined()
        return true
      })

      // Remove item 1
      yield* click(getByTestId("remove-1"))

      // Wait for item 1 to be removed
      yield* waitFor(() => {
        expect(queryByTestId("todo-1")).toBeNull()
        return true
      })

      // Item 2 should STILL be in editing mode (state preserved!)
      expect(getByTestId("edit-input-2")).toBeDefined()
      expect(queryByTestId("text-2")).toBeNull()
    })
  )
})

describe("Signal.each - Edge Cases", () => {
  it.scoped("handles empty list", () =>
    Effect.gen(function* () {
      const EmptyList = Effect.gen(function* () {
        const items = yield* Signal.make<ReadonlyArray<{ id: number; name: string }>>([])

        const listElement = Signal.each(
          items,
          (item) =>
            Effect.succeed(
              <li key={item.id} data-testid={`item-${item.id}`}>
                {item.name}
              </li>
            ),
          { key: (item) => item.id }
        )

        return (
          <ul data-testid="empty-list">{listElement}</ul>
        )
      })

      const { getByTestId, queryByTestId } = yield* render(EmptyList)

      expect(getByTestId("empty-list")).toBeDefined()
      expect(queryByTestId("item-1")).toBeNull()
    })
  )

  it.scoped("handles reordering items", () =>
    Effect.gen(function* () {
      const ReorderList = Effect.gen(function* () {
        const items = yield* Signal.make<ReadonlyArray<{ id: number; name: string }>>([
          { id: 1, name: "A" },
          { id: 2, name: "B" },
          { id: 3, name: "C" }
        ])

        const reverse = () =>
          Signal.update(items, (list) => [...list].reverse())

        const listElement = Signal.each(
          items,
          (item) =>
            Effect.succeed(
              <li key={item.id} data-testid={`item-${item.id}`}>
                {item.name}
              </li>
            ),
          { key: (item) => item.id }
        )

        return (
          <div>
            <ul data-testid="list">{listElement}</ul>
            <button data-testid="reverse" onClick={reverse}>
              Reverse
            </button>
          </div>
        )
      })

      const { getByTestId } = yield* render(ReorderList)

      // Initial order: A, B, C
      const list = getByTestId("list")
      const getItemTexts = () =>
        Array.from(list.querySelectorAll("li")).map((li) => li.textContent)

      expect(getItemTexts()).toEqual(["A", "B", "C"])

      // Click reverse
      yield* click(getByTestId("reverse"))

      // Wait for reorder
      yield* waitFor(() => {
        expect(getItemTexts()).toEqual(["C", "B", "A"])
        return true
      })
    })
  )
})
