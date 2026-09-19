import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureWebEvent } from "../lib/telemetry";

type State = { error?: Error };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureWebEvent({
      event: "web_unhandled_render_error",
      component: info.componentStack?.split("\n")[1]?.trim().slice(0, 120),
      errorCode: error.name,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="public-main">
        <section className="state-panel state-error" role="alert">
          <h1>Something went wrong</h1>
          <p>The application hit an unexpected error. Reload to try again.</p>
          <button className="button button-primary button-md" onClick={() => window.location.reload()}>
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
