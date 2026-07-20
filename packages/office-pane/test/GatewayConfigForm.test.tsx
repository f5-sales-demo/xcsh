/**
 * GatewayConfigForm tests.
 *
 * The in-pane "Gateway" connection form (base URL + token, optional model) that
 * gives xcsh parity with Claude for Office's Gateway config. Validation is
 * delegated to core's normalizeGatewayConfig; the form surfaces its errors.
 */
import { expect, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { GatewayConfig } from '../src/core';
import { GatewayConfigForm } from '../src/panel/GatewayConfigForm';

function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test('renders base URL, token, and model fields plus a Save button', () => {
  render(<GatewayConfigForm onSave={() => {}} />);
  expect(screen.getByLabelText(/gateway url/i)).toBeDefined();
  expect(screen.getByLabelText(/token/i)).toBeDefined();
  expect(screen.getByLabelText(/model/i)).toBeDefined();
  expect(screen.getByRole('button', { name: /save|connect/i })).toBeDefined();
});

test('the token field is a password input (masked)', () => {
  render(<GatewayConfigForm onSave={() => {}} />);
  expect((screen.getByLabelText(/token/i) as HTMLInputElement).type).toBe('password');
});

test('saving a valid base URL + token calls onSave with a normalized config', async () => {
  let saved: GatewayConfig | null = null;
  render(
    <GatewayConfigForm
      onSave={(c) => {
        saved = c;
      }}
    />,
  );

  fill(/gateway url/i, 'https://127-0-0-1.local-ip.sh:8443/anthropic/');
  fill(/token/i, 'sk-secret');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save|connect/i }));
  });

  expect(saved).not.toBeNull();
  const cfg = saved as unknown as GatewayConfig;
  expect(cfg.baseUrl).toBe('https://127-0-0-1.local-ip.sh:8443/anthropic'); // trailing slash stripped
  expect(cfg.token).toBe('sk-secret');
  expect(cfg.model).toBe('claude-opus-4-8'); // default applied
});

test('an optional model overrides the default', async () => {
  let saved: GatewayConfig | null = null;
  render(
    <GatewayConfigForm
      onSave={(c) => {
        saved = c;
      }}
    />,
  );
  fill(/gateway url/i, 'https://gw.example/anthropic');
  fill(/token/i, 't');
  fill(/model/i, 'claude-sonnet-5');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save|connect/i }));
  });
  expect((saved as unknown as GatewayConfig).model).toBe('claude-sonnet-5');
});

test('an invalid (non-https) base URL shows an error and does not call onSave', async () => {
  let called = false;
  render(
    <GatewayConfigForm
      onSave={() => {
        called = true;
      }}
    />,
  );
  fill(/gateway url/i, 'http://gw.example/anthropic');
  fill(/token/i, 't');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save|connect/i }));
  });
  expect(called).toBe(false);
  expect(screen.getByRole('alert').textContent).toMatch(/https/i);
});

test('a missing token shows an error and does not call onSave', async () => {
  let called = false;
  render(
    <GatewayConfigForm
      onSave={() => {
        called = true;
      }}
    />,
  );
  fill(/gateway url/i, 'https://gw.example/anthropic');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save|connect/i }));
  });
  expect(called).toBe(false);
  expect(screen.getByRole('alert').textContent).toMatch(/token/i);
});

test('initial values prefill the form', () => {
  render(
    <GatewayConfigForm
      onSave={() => {}}
      initial={{ baseUrl: 'https://gw.example/anthropic', model: 'claude-opus-4-8' }}
    />,
  );
  expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe('https://gw.example/anthropic');
  expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('claude-opus-4-8');
});

test('a Cancel button appears and fires only when onCancel is provided', async () => {
  let cancelled = false;
  const { rerender } = render(<GatewayConfigForm onSave={() => {}} />);
  expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();

  rerender(
    <GatewayConfigForm
      onSave={() => {}}
      onCancel={() => {
        cancelled = true;
      }}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  });
  expect(cancelled).toBe(true);
});
