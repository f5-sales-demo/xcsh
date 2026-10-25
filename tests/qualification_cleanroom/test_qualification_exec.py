"""Reject unsafe execution forms and preserve literal qualification arguments."""

import subprocess
import unittest
from unittest.mock import patch

import pytest
from qualification_exec import command_arguments, command_output, run_command


class QualificationCommandTests(unittest.TestCase):
    def test_shell_and_invalid_vectors_are_rejected_before_spawning(self):
        for arguments, options in [
            ("/bin/true", {}),
            ([], {}),
            (["/bin/echo", "invalid\0argument"], {}),
            (["/bin/echo", 7], {}),
            (["/bin/echo"], {"shell": True}),
        ]:
            with patch("qualification_exec.subprocess.run") as spawn:
                with pytest.raises((ValueError, TypeError)):
                    run_command(arguments, **options)
                spawn.assert_not_called()

    def test_literal_metacharacters_are_not_interpreted_as_a_shell(self):
        result = command_output(["/bin/echo", "$(false); literal | data"], text=True)
        assert result == "$(false); literal | data\n"

    def test_nonzero_exit_remains_a_failure_and_retains_output(self):
        with pytest.raises(subprocess.CalledProcessError) as caught:
            command_output(["/bin/sh", "-c", "printf preserved; exit 7"], text=True)
        assert caught.value.returncode == 7
        assert caught.value.stdout == "preserved"

    def test_executable_resolution_is_bound_to_the_declared_environment(self):
        assert command_arguments(["echo", "literal"], {"PATH": "/bin"})[0].startswith(
            "/"
        )
        with pytest.raises(FileNotFoundError):
            command_arguments(["qualification-command-that-does-not-exist"])
