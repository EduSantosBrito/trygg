/**
 * Global Loading Fallback
 * 
 * This component is displayed while any route is loading.
 * Uses CSS animation for a smooth loading indicator.
 */
import { Effect } from "effect"

const Loading = Effect.succeed(
  <div className="loading-container">
    <div className="loading-spinner" />
    <p>Loading...</p>
  </div>
)

export default Loading
