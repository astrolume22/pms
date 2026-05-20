import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-app text-text-primary px-6">
        <div className="max-w-md w-full bg-surface border border-border-light rounded-md shadow-md p-8">
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-text-secondary mb-4">
            {this.state.error.message ?? 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="px-4 py-2 rounded-base bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors duration-100"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
