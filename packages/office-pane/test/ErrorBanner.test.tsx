/**
 * ErrorBanner tests. Verifies:
 *  (a) Every CHAT_ERROR_REASONS value has a non-empty mapped message.
 *  (b) Representative reasons render distinct, non-empty messages.
 *  (c) Retry click calls retry.
 *  (d) bridge-disconnected (transport connect-failure) renders.
 */
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CHAT_ERROR_REASONS, type ChatErrorReason } from '../src/core';
import { ERROR_MESSAGES, ErrorBanner } from '../src/panel/ErrorBanner';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// (a) Exhaustiveness: every reason has a non-empty mapped message
// ---------------------------------------------------------------------------

test('ERROR_MESSAGES covers every CHAT_ERROR_REASONS value with a non-empty string', () => {
  for (const reason of CHAT_ERROR_REASONS) {
    const msg = ERROR_MESSAGES[reason as ChatErrorReason];
    expect(typeof msg).toBe('string');
    expect(msg.trim().length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// (b) Representative reasons render distinct messages
// ---------------------------------------------------------------------------

test('session-busy renders a non-empty, distinct message', () => {
  const { container } = render(<ErrorBanner reason="session-busy" onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  const text = el.textContent ?? '';
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).toContain(ERROR_MESSAGES['session-busy']);
});

test('token-expired renders a non-empty, distinct message different from session-busy', () => {
  const { container } = render(<ErrorBanner reason="token-expired" onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  const text = el.textContent ?? '';
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).toContain(ERROR_MESSAGES['token-expired']);
  expect(ERROR_MESSAGES['token-expired']).not.toBe(ERROR_MESSAGES['session-busy']);
});

test('provider-5xx renders a non-empty message', () => {
  const { container } = render(<ErrorBanner reason="provider-5xx" onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  const text = el.textContent ?? '';
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).toContain(ERROR_MESSAGES['provider-5xx']);
});

// ---------------------------------------------------------------------------
// (d) bridge-disconnected (connect-failure path) renders
// ---------------------------------------------------------------------------

test('bridge-disconnected renders a non-empty message', () => {
  const { container } = render(<ErrorBanner reason="bridge-disconnected" onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  const text = el.textContent ?? '';
  expect(text.trim().length).toBeGreaterThan(0);
  expect(text).toContain(ERROR_MESSAGES['bridge-disconnected']);
});

// ---------------------------------------------------------------------------
// (e) Reason-less errors — surface raw error text, else a generic fallback
// ---------------------------------------------------------------------------

test('with no reason, renders the raw error text', () => {
  const { container } = render(<ErrorBanner error="Upstream exploded: 502 xyz" onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  expect(el.textContent ?? '').toContain('Upstream exploded: 502 xyz');
  // Retry is still offered.
  expect(within(container).getByRole('button', { name: /retry/i })).toBeDefined();
});

test('with neither reason nor error, renders a non-empty generic fallback', () => {
  const { container } = render(<ErrorBanner onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  expect((el.textContent ?? '').trim().length).toBeGreaterThan(0);
});

test('reason takes precedence over raw error text', () => {
  const { container } = render(<ErrorBanner reason="token-expired" error="raw fallback" onRetry={() => {}} />);
  const el = within(container).getByRole('alert');
  expect(el.textContent ?? '').toContain(ERROR_MESSAGES['token-expired']);
});

// ---------------------------------------------------------------------------
// (c) Retry button calls the onRetry callback
// ---------------------------------------------------------------------------

test('Retry button calls onRetry', async () => {
  let retried = false;
  render(
    <ErrorBanner
      reason="provider-5xx"
      onRetry={() => {
        retried = true;
      }}
    />,
  );
  const retryBtn = screen.getByRole('button', { name: /retry/i });
  await act(async () => {
    fireEvent.click(retryBtn);
  });
  expect(retried).toBe(true);
});

// ---------------------------------------------------------------------------
// All reasons render without crashing
// ---------------------------------------------------------------------------

test('ErrorBanner renders for every known reason without crashing', () => {
  for (const reason of CHAT_ERROR_REASONS) {
    const { container, unmount } = render(<ErrorBanner reason={reason} onRetry={() => {}} />);
    const el = within(container).getByRole('alert');
    expect(el).toBeDefined();
    unmount();
  }
});
