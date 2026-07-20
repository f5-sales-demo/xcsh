/**
 * GatewayGate tests.
 *
 * The gate decides what the pane shows: the gateway config form when no config
 * is stored, or the ChatPanel (over a transport built from the config) once one
 * is. It persists via an injected GatewayConfigStore and builds the transport
 * via an injected factory, so it is transport-agnostic and unit-testable.
 */
import { expect, test } from 'bun:test';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type GatewayConfig, MemoryGatewayConfigStore, MockTransport, normalizeGatewayConfig } from '../src/core';
import { GatewayGate } from '../src/panel/GatewayGate';

const CONFIG = normalizeGatewayConfig({ baseUrl: 'https://gw.example/anthropic', token: 't' });

function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

test('with no stored config, renders the config form (not the chat)', () => {
  const store = new MemoryGatewayConfigStore();
  render(<GatewayGate store={store} buildTransport={() => ({ transport: new MockTransport() })} />);
  expect(screen.getByLabelText(/gateway url/i)).toBeDefined();
  expect(screen.queryByLabelText(/message input/i)).toBeNull();
});

test('saving a config persists it and switches to the chat over the built transport', async () => {
  const store = new MemoryGatewayConfigStore();
  const built: GatewayConfig[] = [];
  render(
    <GatewayGate
      store={store}
      buildTransport={(cfg) => {
        built.push(cfg);
        return { transport: new MockTransport() };
      }}
    />,
  );

  fill(/gateway url/i, 'https://gw.example/anthropic');
  fill(/token/i, 'sk-1');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /save|connect/i }));
  });

  // Persisted and transport built from the saved config.
  expect(store.load()?.token).toBe('sk-1');
  expect(built).toHaveLength(1);
  expect(built[0].baseUrl).toBe('https://gw.example/anthropic');
  // Chat is now shown.
  expect(screen.getByLabelText(/message input/i)).toBeDefined();
});

test('with a stored config, renders the chat directly and builds the transport from it', () => {
  const store = new MemoryGatewayConfigStore();
  store.save(CONFIG);
  const built: GatewayConfig[] = [];
  render(
    <GatewayGate
      store={store}
      buildTransport={(cfg) => {
        built.push(cfg);
        return { transport: new MockTransport() };
      }}
    />,
  );
  expect(screen.getByLabelText(/message input/i)).toBeDefined();
  expect(screen.queryByLabelText(/gateway url/i)).toBeNull();
  expect(built).toEqual([CONFIG]);
});

test('the transport is built once, not on every render', () => {
  const store = new MemoryGatewayConfigStore();
  store.save(CONFIG);
  let calls = 0;
  const { rerender } = render(
    <GatewayGate
      store={store}
      buildTransport={() => {
        calls += 1;
        return { transport: new MockTransport() };
      }}
    />,
  );
  rerender(
    <GatewayGate
      store={store}
      buildTransport={() => {
        calls += 1;
        return { transport: new MockTransport() };
      }}
    />,
  );
  expect(calls).toBe(1);
});

test('the Settings affordance reopens the form prefilled, and Cancel returns to chat', async () => {
  const store = new MemoryGatewayConfigStore();
  store.save(CONFIG);
  render(<GatewayGate store={store} buildTransport={() => ({ transport: new MockTransport() })} />);

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
  });
  // Form is shown, prefilled with the stored base URL.
  expect((screen.getByLabelText(/gateway url/i) as HTMLInputElement).value).toBe('https://gw.example/anthropic');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  });
  // Back to chat.
  expect(screen.getByLabelText(/message input/i)).toBeDefined();
});
