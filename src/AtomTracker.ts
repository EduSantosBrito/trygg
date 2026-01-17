/**
 * @since 1.0.0
 * AtomTracker - Tracks atoms accessed during component rendering
 * 
 * This is used by the re-render mechanism to know which atoms
 * a component depends on, so it can subscribe to updates.
 */
import { Effect, FiberRef } from "effect"
import type { Atom } from "@effect-atom/atom"

/**
 * AtomTracker interface - accumulates atoms during render
 * @since 1.0.0
 */
export interface AtomTracker {
  /**
   * The set of atoms tracked during this render
   */
  readonly atoms: Set<Atom.Atom<unknown>>
  
  /**
   * Add an atom to the tracker
   */
  readonly add: (atom: Atom.Atom<unknown>) => void
}

/**
 * Create a new AtomTracker
 * @since 1.0.0
 */
export const make = (): AtomTracker => {
  const atoms = new Set<Atom.Atom<unknown>>()
  return {
    atoms,
    add: (atom) => atoms.add(atom)
  }
}

/**
 * FiberRef to track the current AtomTracker during component rendering.
 * When null, no tracking is active.
 * @since 1.0.0
 */
export const CurrentAtomTracker: FiberRef.FiberRef<AtomTracker | null> = 
  FiberRef.unsafeMake<AtomTracker | null>(null)

/**
 * Get the current tracker if one is active
 * @since 1.0.0
 */
export const getCurrent: Effect.Effect<AtomTracker | null> = 
  FiberRef.get(CurrentAtomTracker)

/**
 * Track an atom with the current tracker (if active)
 * Returns an effect that tracks the atom and returns void
 * @since 1.0.0
 */
export const track = Effect.fn("AtomTracker.track")(
  function* <A>(atom: Atom.Atom<A>) {
    const tracker = yield* FiberRef.get(CurrentAtomTracker)
    if (tracker !== null) {
      tracker.add(atom)
    }
  }
)

/**
 * Run an effect with a new tracker, returns the tracked atoms after completion
 * @since 1.0.0
 */
export const withTracking = Effect.fn("AtomTracker.withTracking")(
  function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
    const tracker = make()
    const result = yield* Effect.locally(effect, CurrentAtomTracker, tracker)
    return [result, tracker.atoms] as const
  }
)
