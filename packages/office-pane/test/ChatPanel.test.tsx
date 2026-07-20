import { expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { MockTransport } from '../src/core';
import { ChatPanel } from '../src/panel';

test('renders the panel shell with an empty state', () => {
  render(<ChatPanel transport={new MockTransport()} />);
  expect(screen.getByRole('log', { name: /conversation/i })).toBeDefined();
  expect(screen.getByRole('textbox')).toBeDefined();
});
