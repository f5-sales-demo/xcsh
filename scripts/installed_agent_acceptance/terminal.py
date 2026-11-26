"""Installed executable acceptance: terminal."""

from __future__ import annotations

import codecs
import contextlib
import fcntl
import json
import os
import pty
import re
import selectors
import signal
import struct
import subprocess
import termios
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .common import ERASE_WHOLE_LINE, PRINTABLE_CHARACTER, fail, write_json

if TYPE_CHECKING:
    import pathlib
    from collections.abc import Callable
    from typing import BinaryIO, TextIO


class Screen:
    """Small VT observer for wait conditions; render receipts use the existing xterm renderer."""

    def __init__(self, rows: int = 40, cols: int = 120) -> None:
        """Observe init for the acceptance fixture."""
        self.rows, self.cols = rows, cols
        self.cells = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.saved = (0, 0)
        self.pending = ""

    def feed(self, text: str) -> None:
        """Observe feed for the acceptance fixture."""
        text = self.pending + text
        self.pending = ""
        i = 0
        while i < len(text):
            c = text[i]
            if c == "\x1b":
                match = re.match(r"\x1b\[([?=>0-9;:]*)([ -/]*)([@-~])", text[i:])
                if match:
                    args, _, command = match.groups()
                    private = args.startswith("?")
                    nums = [
                        int(n or 0)
                        for n in args.lstrip("?=>").split(";")
                        if ":" not in n
                    ]
                    n = nums[0] if nums and nums[0] else 1
                    if not private:
                        self.control(command, nums, n)
                    i += len(match.group(0))
                    continue
                if text[i : i + 2] in ("\x1b]", "\x1bP"):
                    match = re.match(
                        r"\x1b[\]P].*?(?:\x07|\x1b\\)", text[i:], re.DOTALL
                    )
                    if match:
                        i += len(match.group(0))
                        continue
                    self.pending = text[i:]
                    break
                if i + 1 >= len(text) or text[i + 1] == "[":
                    self.pending = text[i:]
                    break
                i += 3 if text[i + 1] in "()" else 2
                continue
            if c == "\r":
                self.col = 0
            elif c == "\n":
                self.row += 1
                if self.row >= self.rows:
                    self.cells.pop(0)
                    self.cells.append([" "] * self.cols)
                    self.row = self.rows - 1
            elif c == "\b":
                self.col = max(0, self.col - 1)
            elif c == "\t":
                self.col = min(self.cols - 1, (self.col // 8 + 1) * 8)
            elif ord(c) >= PRINTABLE_CHARACTER:
                if self.col >= self.cols:
                    self.col = 0
                    self.row = min(self.rows - 1, self.row + 1)
                self.cells[self.row][self.col] = c
                self.col += 1
            i += 1

    def text(self) -> str:
        """Observe text for the acceptance fixture."""
        return "\n".join("".join(row).rstrip() for row in self.cells)

    def control(self, command: str, nums: list[int], n: int) -> None:
        """Apply a complete cursor control sequence."""
        if command in "Hf":
            self.row = min(self.rows - 1, max(0, n - 1))
            self.col = min(
                self.cols - 1,
                max(0, (nums[1] if len(nums) > 1 and nums[1] else 1) - 1),
            )
        elif command == "A":
            self.row = max(0, self.row - n)
        elif command == "B":
            self.row = min(self.rows - 1, self.row + n)
        elif command == "C":
            self.col = min(self.cols - 1, self.col + n)
        elif command == "D":
            self.col = max(0, self.col - n)
        elif command == "G":
            self.col = min(self.cols - 1, n - 1)
        elif command == "d":
            self.row = min(self.rows - 1, n - 1)
        elif command in "JK":
            self.erase(command, nums[0] if nums else 0)
        elif command == "s":
            self.saved = (self.row, self.col)
        elif command == "u":
            self.row, self.col = self.saved

    def erase(self, command: str, mode: int) -> None:
        """Apply line and display erasure."""
        if command == "J":
            if mode in (2, 3):
                self.cells = [[" "] * self.cols for _ in range(self.rows)]
            elif mode == 0:
                self.cells[self.row][self.col :] = [" "] * (self.cols - self.col)
                for row in range(self.row + 1, self.rows):
                    self.cells[row] = [" "] * self.cols
        elif command == "K":
            start, end = (
                (0, self.cols)
                if mode == ERASE_WHOLE_LINE
                else (0, self.col + 1)
                if mode == 1
                else (self.col, self.cols)
            )
            self.cells[self.row][start:end] = [" "] * (end - start)


@dataclass
class TerminalIO:
    """Own descriptors, decoder and process resources for one terminal."""

    files: contextlib.ExitStack = field(default_factory=contextlib.ExitStack)
    master: int = -1
    selector: selectors.BaseSelector = field(default_factory=selectors.DefaultSelector)
    stream: BinaryIO = field(init=False)
    inputs: TextIO = field(init=False)
    decoder: codecs.IncrementalDecoder = field(init=False)


class Terminal:
    """Control one task-owned PTY and preserve its exact byte stream."""

    def __init__(
        self,
        args: list[str],
        env: dict[str, str],
        cwd: pathlib.Path,
        private: pathlib.Path,
    ) -> None:
        """Observe init for the acceptance fixture."""
        self.io = TerminalIO()
        self.screen = Screen()
        self.io.master, slave = pty.openpty()
        fcntl.ioctl(
            slave,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", self.screen.rows, self.screen.cols, 0, 0),
        )
        self.process = self.io.files.enter_context(
            subprocess.Popen(  # noqa: S603 - validated absolute CLI path and exact argv, no shell
                args,
                env=env,
                cwd=cwd,
                stdin=slave,
                stdout=slave,
                stderr=slave,
                start_new_session=True,
                close_fds=True,
            )
        )
        os.close(slave)
        os.set_blocking(self.io.master, False)
        self.io.selector.register(self.io.master, selectors.EVENT_READ)
        self.io.stream = self.io.files.enter_context((private / "pty.bin").open("wb"))
        self.io.inputs = self.io.files.enter_context(
            (private / "input.jsonl").open("w")
        )
        self.io.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.raw = ""
        self.private = private
        self.snapshots = 0
        self.bang_obligations: list[tuple[str, str]] = []

    def send(self, text: str) -> None:
        """Observe send for the acceptance fixture."""
        self.io.inputs.write(json.dumps({"at": time.monotonic(), "text": text}) + "\n")
        self.io.inputs.flush()
        os.write(self.io.master, text.encode())

    def pump(self, timeout: float = 0.05) -> None:
        """Observe pump for the acceptance fixture."""
        for _, _ in self.io.selector.select(timeout):
            try:
                chunk = os.read(self.io.master, 65536)
            except OSError:
                return
            if not chunk:
                return
            self.io.stream.write(chunk)
            self.io.stream.flush()
            text = self.io.decoder.decode(chunk)
            self.raw += text
            self.screen.feed(text)
            if "\x1b[6n" in text:
                os.write(self.io.master, b"\x1b[1;1R")
            if "\x1b[c" in text:
                os.write(self.io.master, b"\x1b[?1;2c")

    def wait(
        self, predicate: Callable[[], bool], label: str, seconds: float = 25
    ) -> None:
        """Observe wait for the acceptance fixture."""
        deadline = time.monotonic() + seconds
        while not predicate():
            self.pump()
            if self.process.poll() is not None or time.monotonic() > deadline:
                self.capture("failed-" + label)
                fail("PTY did not reach " + label)

    def settle(self, seconds: float = 0.4) -> None:
        """Observe settle for the acceptance fixture."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump()

    def capture(
        self,
        label: str,
        *,
        required: tuple[str, ...] = (),
        forbidden: tuple[str, ...] = (),
    ) -> None:
        """Observe capture for the acceptance fixture."""
        self.snapshots += 1
        write_json(
            self.private / (f"viewport-{self.snapshots:02d}.json"),
            {
                "label": label,
                "streamBytes": self.io.stream.tell(),
                "rows": self.screen.rows,
                "columns": self.screen.cols,
                "observerText": self.screen.text(),
                "requiredText": list(required),
                "forbiddenText": list(forbidden),
            },
        )

    def close(self) -> None:
        """Observe close for the acceptance fixture."""
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.pump(0)
        self.io.stream.close()
        self.io.inputs.close()
        self.io.files.close()
        self.io.selector.close()
        os.close(self.io.master)
