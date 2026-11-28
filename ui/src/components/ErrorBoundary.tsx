import React from 'react';

export interface ErrorBoundaryProps {
  scopeLabel?: string;
  title?: string;
  resetKey?: string | number | null;
  onReturnHome?: () => void;
  retryLabel?: string;
  returnHomeLabel?: string;
  reloadLabel?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

function formatSafeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unexpected UI error');
  return raw.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 280) || 'Unexpected UI error';
}

/**
 * Self-contained React ErrorBoundary that never depends on I18nContext so it can safely
 * guard both the root `<App />` shell and individual module panels without blank screens.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: formatSafeError(error),
    };
  }

  override componentDidCatch(error: unknown): void {
    // Keep error logging minimal and local to avoid spamming host logs
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error(`[agy-NOV UI ErrorBoundary:${this.props.scopeLabel ?? 'root'}]`, error);
    }
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  private handleReload = (): void => {
    try {
      if (
        typeof window !== 'undefined' &&
        window.location &&
        (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
        typeof window.location.reload === 'function'
      ) {
        window.location.reload();
        return;
      }
    } catch {
      // Sandboxed/srcdoc MCP Apps iframes may block location.reload(); fall back to clean React reset.
    }
    this.handleReset();
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const scope = this.props.scopeLabel || 'agy-NOV';
    const heading = this.props.title ?? `${scope} encountered a render error`;
    return (
      <div className="nov-error-boundary" role="alert" aria-live="assertive">
        <div className="nov-error-boundary-card">
          <div className="nov-error-boundary-head">
            <span className="nov-error-boundary-dot" aria-hidden="true">
              !
            </span>
            <h3>{heading}</h3>
          </div>
          <p className="nov-error-boundary-msg">{this.state.errorMessage}</p>
          <div className="nov-error-boundary-actions">
            <button type="button" className="nov-open-btn is-active" onClick={this.handleReset}>
              {this.props.retryLabel ?? 'Retry'}
            </button>
            {this.props.onReturnHome && (
              <button
                type="button"
                className="nov-open-btn"
                onClick={() => {
                  this.handleReset();
                  this.props.onReturnHome?.();
                }}
              >
                {this.props.returnHomeLabel ?? 'Back to Hub'}
              </button>
            )}
            <button type="button" className="nov-open-btn" onClick={this.handleReload}>
              {this.props.reloadLabel ?? 'Reload Panel'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
