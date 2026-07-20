/**
 * InputBar tests. Tests drive through a wrapper component that wires
 * MockTransport → useChatSession → InputBar, matching how ChatPanel uses it.
 * initTurn sets status='streaming' immediately on send(), so no delta injection
 * is needed to reach the streaming state.
 */
import { expect, test } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ChatRequestMsg, MockTransport } from '../src/core';
import { InputBar } from '../src/panel/InputBar';
import { useChatSession } from '../src/panel/useChatSession';

function InputBarWrapper({ transport }: { transport: MockTransport }) {
  const session = useChatSession(transport);
  return <InputBar onSend={session.send} onStop={session.stop} status={session.status} />;
}

test('typing and clicking Send calls send with the typed text and clears the input', async () => {
  const mock = new MockTransport();
  render(<InputBarWrapper transport={mock} />);

  const textarea = screen.getByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'Hello world' } });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
  });

  const reqs = mock.sent.filter((m): m is ChatRequestMsg => m.type === 'chat_request');
  expect(reqs).toHaveLength(1);
  expect(reqs[0]?.text).toBe('Hello world');
  // Input should be cleared after send
  expect((textarea as HTMLTextAreaElement).value).toBe('');
});

test('Send button is disabled while status is streaming', async () => {
  const mock = new MockTransport();
  render(<InputBarWrapper transport={mock} />);

  // Send a message — initTurn sets status='streaming' immediately
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
  });

  await waitFor(() => {
    const sendBtn = screen.getByRole('button', { name: /send/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

test('Stop button appears when status is streaming and its click calls stop', async () => {
  const mock = new MockTransport();
  render(<InputBarWrapper transport={mock} />);

  // Trigger streaming state
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
  });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /stop/i })).toBeDefined();
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
  });

  // stop() calls transport.stop(id) which emits a chat_stop
  const stops = mock.sent.filter((m) => m.type === 'chat_stop');
  expect(stops).toHaveLength(1);
});

test('Stop button is NOT present when status is idle', () => {
  render(<InputBar onSend={() => {}} onStop={() => {}} status="idle" />);
  expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
});
